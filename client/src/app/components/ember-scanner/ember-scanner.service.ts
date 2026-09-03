/*
 * *****************************************************************************
 * Copyright (C) 2019-2026 Chrystian Huot <chrystian.huot@saubeo.solutions>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>
 * ****************************************************************************
 */


import { EventEmitter, Inject, Injectable, OnDestroy, DOCUMENT } from '@angular/core';
import { Router } from '@angular/router';
import { interval, Observable, Subject, Subscription, timer, timeout } from 'rxjs';
import { ScannerActivity } from './activity/activity';
import { ScannerAudioOutput } from './audio-output';
import { takeWhile } from 'rxjs/operators';
import {
    EmberScannerAvoidOptions,
    EmberScannerBeepStyle,
    EmberScannerCall,
    EmberScannerCategory,
    EmberScannerCategoryStatus,
    EmberScannerCategoryType,
    EmberScannerConfig,
    EmberScannerEvent,
    EmberScannerLivefeed,
    EmberScannerLivefeedMap,
    EmberScannerLivefeedMode,
    EmberScannerOscillatorData,
    EmberScannerPlaybackList,
    EmberScannerSearchOptions,
} from './ember-scanner';

declare global {
    interface Window {
        webkitAudioContext: typeof AudioContext;
    }
}

enum WebsocketCallFlag {
    Download = 'd',
    History = 'h',
    Play = 'p',
}

enum WebsocketCommand {
    Activity = 'ACT',
    Call = 'CAL',
    Config = 'CFG',
    Expired = 'XPR',
    ListCall = 'LCL',
    ListenersCount = 'LSC',
    LivefeedMap = 'LFM',
    Max = 'MAX',
    Pin = 'PIN',
    PinLocked = 'LCK',
    Version = 'VER',
}

@Injectable()
export class EmberScannerService implements OnDestroy {
    static LOCAL_STORAGE_KEY_LEGACY = 'ember-scanner';
    static LOCAL_STORAGE_KEY_LFM = 'ember-scanner-lfm';
    static STORAGE_KEY_PIN = 'ember-scanner-pin';

    event = new EventEmitter<EmberScannerEvent>();

    private activitySequence = 0;
    private readonly activityResponses = new Subject<{ id: string; data: ScannerActivity & { error?: string } }>();

    getActivity(hours: number, systemId: number): Observable<ScannerActivity> {
        return new Observable<ScannerActivity>(observer => {
            if (this.websocket?.readyState !== WebSocket.OPEN) {
                observer.error(new Error('Scanner link offline'));
                return;
            }
            const id = String(++this.activitySequence);
            const subscription = this.activityResponses.subscribe(response => {
                if (response.id !== id) return;
                if (response.data.error) observer.error(new Error(response.data.error));
                else { observer.next(response.data); observer.complete(); }
            });
            this.sendtoWebsocket(WebsocketCommand.Activity, { hours, system: systemId }, id);
            return () => subscription.unsubscribe();
        }).pipe(timeout(12_000));
    }

    private audioContext: AudioContext | undefined;
    private audioOutput: ScannerAudioOutput | undefined;
    private destroyed = false;
    private readonly audioCleanup: (() => void)[] = [];
    private readonly mediaActions: MediaSessionAction[] = [];
    private reconnectTimer: Subscription | undefined;

    private audioGain: GainNode | undefined;

    private audioSource: AudioBufferSourceNode | undefined;
    private audioSourceStartTime = NaN;
    private audioDecodeGeneration = 0;

    private volumeLevel = 1;

    private call: EmberScannerCall | undefined;
    private callPrevious: EmberScannerCall | undefined;
    private callQueue: EmberScannerCall[] = [];

    private categories: EmberScannerCategory[] = [];

    private config: EmberScannerConfig = {
        dimmerDelay: false,
        groups: {},
        groupsData: [],
        keypadBeeps: undefined,
        playbackGoesLive: false,
        showErrorsAndSpikes: true,
        showListenersCount: false,
        systems: [],
        tags: {},
        tagsData: [],
        time12hFormat: false,
    };

    private instanceId = 'default';

    private livefeedMap = {} as EmberScannerLivefeedMap;
    private livefeedMapPriorToHoldSystem: EmberScannerLivefeedMap | undefined;
    private livefeedMapPriorToHoldTalkgroup: EmberScannerLivefeedMap | undefined;
    private livefeedMode = EmberScannerLivefeedMode.Offline;
    private livefeedPaused = false;

    private oscillatorContext: AudioContext | undefined;

    private playbackList: EmberScannerPlaybackList | undefined;
    private playbackPending: number | undefined;
    private playbackRefreshing = false;
    private playbackSearchAppend = false;
    private historyPlaybackPending: number | undefined;
    private historyRequest = 0;

    private skipDelay: Subscription | undefined;

    private websocket: WebSocket | undefined;

    constructor(
        private router: Router,
        @Inject(DOCUMENT) private document: Document,
    ) {
        if (router.url.endsWith('/reset')) {
            this.clearStoredState();

            router.navigateByUrl(router.url.replace('/reset', ''), {
                replaceUrl: true,
            }).then(() => window?.location?.reload());

            return;
        }

        // Remove PINs persisted by older releases; credentials now live only for this browser tab.
        window?.localStorage?.removeItem(EmberScannerService.STORAGE_KEY_PIN);

        this.bootstrapAudio();

        this.initializeInstanceId();

        this.readLivefeedMap();

        this.openWebsocket();
    }

    authenticate(password: string): void {
        this.sendtoWebsocket(WebsocketCommand.Pin, window.btoa(password));
    }

    getSelectionState(): EmberScannerEvent {
        return {
            categories: this.categories,
            config: this.config,
            map: this.livefeedMap,
        };
    }

    avoid(options: EmberScannerAvoidOptions = {}): void {
        const clearTimer = (lfm: EmberScannerLivefeed): void => {
            lfm.minutes = undefined;
            lfm.timer?.unsubscribe();
            lfm.timer = undefined;
        };

        const setTimer = (lfm: EmberScannerLivefeed, minutes: number): void => {
            const timerMap = this.livefeedMap;

            lfm.minutes = minutes;
            lfm.timer = timer(minutes * 60 * 1000).subscribe(() => {
                lfm.active = true;
                lfm.minutes = undefined;
                lfm.timer = undefined;

                this.saveLivefeedMap(timerMap);

                if (timerMap === this.livefeedMap) {
                    this.rebuildCategories();
                    this.syncLivefeedMap();

                    this.event.emit({
                        categories: this.categories,
                        map: this.livefeedMap,
                    });
                }
            });
        };

        if (this.livefeedMapPriorToHoldSystem) {
            this.cancelLivefeedTimers(this.livefeedMapPriorToHoldSystem);
            this.livefeedMapPriorToHoldSystem = undefined;
        }

        if (this.livefeedMapPriorToHoldTalkgroup) {
            this.cancelLivefeedTimers(this.livefeedMapPriorToHoldTalkgroup);
            this.livefeedMapPriorToHoldTalkgroup = undefined;
        }

        if (typeof options.all === 'boolean') {
            Object.keys(this.livefeedMap).map((sys: string) => +sys).forEach((sys: number) => {
                Object.keys(this.livefeedMap[sys]).map((tg: string) => +tg).forEach((tg: number) => {
                    const lfm = this.livefeedMap[sys][tg];
                    clearTimer(lfm);
                    lfm.active = typeof options.status === 'boolean' ? options.status : !!options.all;
                });
            });

        } else if (options.call) {
            const lfm = this.livefeedMap[options.call.system][options.call.talkgroup];
            clearTimer(lfm);
            lfm.active = typeof options.status === 'boolean' ? options.status : !lfm.active;
            if (typeof options.minutes === 'number') setTimer(lfm, options.minutes);

        } else if (options.system && options.talkgroup) {
            const lfm = this.livefeedMap[options.system.id][options.talkgroup.id];
            clearTimer(lfm);
            lfm.active = typeof options.status === 'boolean' ? options.status : !lfm.active;
            if (typeof options.minutes === 'number') setTimer(lfm, options.minutes);

        } else if (options.system && !options.talkgroup) {
            const sys = options.system.id;
            Object.keys(this.livefeedMap[sys]).map((tg: string) => +tg).forEach((tg: number) => {
                const lfm = this.livefeedMap[sys][tg];
                clearTimer(lfm);
                lfm.active = typeof options.status === 'boolean' ? options.status : !lfm.active;
            });

        } else {
            const call = this.call || this.callPrevious;
            if (call) {
                const lfm = this.livefeedMap[call.system][call.talkgroup];
                clearTimer(lfm);
                lfm.active = typeof options.status === 'boolean' ? options.status : !lfm.active;
                if (typeof options.minutes === 'number') setTimer(lfm, options.minutes);
            }
        }

        if (this.livefeedMode !== EmberScannerLivefeedMode.Playback) {
            this.cleanQueue();
        }

        this.rebuildCategories();

        this.saveLivefeedMap();

        this.syncLivefeedMap();

        this.event.emit({
            categories: this.categories,
            holdSys: false,
            holdTg: false,
            map: this.livefeedMap,
            queue: this.callQueue.length,
        });
    }

    async beep(style = EmberScannerBeepStyle.Activate): Promise<void> {
        const configuredSequence = this.config.keypadBeeps?.[style];
        const fallbackSequences: Record<EmberScannerBeepStyle, EmberScannerOscillatorData[]> = {
            [EmberScannerBeepStyle.Activate]: [
                { begin: 0, end: .05, frequency: 1200, type: 'square' },
            ],
            [EmberScannerBeepStyle.Deactivate]: [
                { begin: 0, end: .06, frequency: 1200, type: 'square' },
                { begin: .06, end: .12, frequency: 925, type: 'square' },
            ],
            [EmberScannerBeepStyle.Denied]: [
                { begin: 0, end: .05, frequency: 925, type: 'square' },
                { begin: .08, end: .13, frequency: 925, type: 'square' },
            ],
        };
        const seq = configuredSequence?.length ? configuredSequence : fallbackSequences[style];

        await this.playOscillatorSequence(seq);
    }

    clearPin(): void {
        window?.sessionStorage?.removeItem(EmberScannerService.STORAGE_KEY_PIN);
        window?.localStorage?.removeItem(EmberScannerService.STORAGE_KEY_PIN);
    }

    holdSystem(options?: { resubscribe?: boolean }): void {
        const call = this.call || this.callPrevious;

        if (call && this.livefeedMap) {
            if (this.livefeedMapPriorToHoldSystem) {
                this.livefeedMap = this.livefeedMapPriorToHoldSystem;

                this.livefeedMapPriorToHoldSystem = undefined;

            } else {
                if (this.livefeedMapPriorToHoldTalkgroup) {
                    this.holdTalkgroup({ resubscribe: false });
                }

                this.livefeedMapPriorToHoldSystem = this.livefeedMap;

                this.livefeedMap = Object.keys(this.livefeedMap).map((sys) => +sys).reduce((sysMap, sys) => {
                    const allOff = Object.keys(this.livefeedMap[sys]).map((tg) => +tg)
                        .every((tg) => !this.livefeedMap[sys][tg].active);

                    sysMap[sys] = Object.keys(this.livefeedMap[sys]).map((tg) => +tg).reduce((tgMap, tg) => {
                        tgMap[tg] = {
                            active: sys === call.system ? allOff || this.livefeedMap[sys][tg].active : false,
                        } as EmberScannerLivefeed;

                        return tgMap;
                    }, {} as { [key: number]: EmberScannerLivefeed });

                    return sysMap;
                }, {} as EmberScannerLivefeedMap);

                this.cleanQueue();
            }

            this.rebuildCategories();

            if (typeof options?.resubscribe !== 'boolean' || options.resubscribe) {
                this.syncLivefeedMap();
            }

            this.event.emit({
                categories: this.categories,
                holdSys: !!this.livefeedMapPriorToHoldSystem,
                holdTg: false,
                map: this.livefeedMap,
                queue: this.callQueue.length,
            });
        }
    }

    holdTalkgroup(options?: { resubscribe?: boolean }): void {
        const call = this.call || this.callPrevious;

        if (call && this.livefeedMap) {
            if (this.livefeedMapPriorToHoldTalkgroup) {
                this.livefeedMap = this.livefeedMapPriorToHoldTalkgroup;

                this.livefeedMapPriorToHoldTalkgroup = undefined;

            } else {
                if (this.livefeedMapPriorToHoldSystem) {
                    this.holdSystem({ resubscribe: false });
                }

                this.livefeedMapPriorToHoldTalkgroup = this.livefeedMap;

                this.livefeedMap = Object.keys(this.livefeedMap).map((sys) => +sys).reduce((sysMap, sys) => {
                    sysMap[sys] = Object.keys(this.livefeedMap[sys]).map((tg) => +tg).reduce((tgMap, tg) => {
                        tgMap[tg] = {
                            active: sys === call.system ? tg === call.talkgroup : false,
                        } as EmberScannerLivefeed;

                        return tgMap;
                    }, {} as { [key: number]: EmberScannerLivefeed });

                    return sysMap;
                }, {} as EmberScannerLivefeedMap);

                this.cleanQueue();
            }

            this.rebuildCategories();

            if (typeof options?.resubscribe !== 'boolean' || options.resubscribe) {
                this.syncLivefeedMap();
            }

            this.event.emit({
                categories: this.categories,
                holdSys: false,
                holdTg: !!this.livefeedMapPriorToHoldTalkgroup,
                map: this.livefeedMap,
                queue: this.callQueue.length,
            });
        }
    }

    isAvoided(call: EmberScannerCall): boolean {
        return !!this.livefeedMap[call.system] && this.livefeedMap[call.system][call.talkgroup]?.active !== true;
    }

    isAvoidedTimer(call: EmberScannerCall): number {
        if (!!this.livefeedMap[call.system] && this.livefeedMap[call.system][call.talkgroup]?.minutes !== undefined) {
            return this.livefeedMap[call.system][call.talkgroup]?.minutes || 0;
        }
        return 0;
    }

    isPatched(call: EmberScannerCall): boolean {
        return this.isAvoided(call) && call.patches?.some((tg) => {
            return !!this.livefeedMap[call.system] && this.livefeedMap[call.system][tg]?.active || false;
        });
    }

    hasPatches(call: EmberScannerCall): boolean {
        const talkgroups = new Set<number>([call.talkgroup]);

        call.patches?.forEach((talkgroup) => {
            if (talkgroup > 0) {
                talkgroups.add(talkgroup);
            }
        });

        return talkgroups.size > 1;
    }

    livefeed(): void {
        if (this.livefeedMode === EmberScannerLivefeedMode.Offline) {
            this.startLivefeed();

        } else if (this.livefeedMode === EmberScannerLivefeedMode.Online) {
            this.stopLivefeed();

        } else if (this.livefeedMode === EmberScannerLivefeedMode.Playback) {
            this.stopPlaybackMode();
        }
    }

    loadAndDownload(id: number): void {
        if (!id) {
            return;
        }

        this.getCall(id, WebsocketCallFlag.Download);
    }

    loadAndPlay(id: number): void {
        if (!id) {
            return;
        }

        if (this.skipDelay) {
            this.skipDelay.unsubscribe();

            this.skipDelay = undefined;
        }

        this.playbackPending = id;

        this.stop();

        if (this.livefeedMode === EmberScannerLivefeedMode.Offline) {
            this.livefeedMode = EmberScannerLivefeedMode.Playback;

            if (this.livefeedMapPriorToHoldSystem) {
                this.holdSystem({ resubscribe: false });
            }

            if (this.livefeedMapPriorToHoldTalkgroup) {
                this.holdTalkgroup({ resubscribe: false });
            }

            this.event.emit({ livefeedMode: this.livefeedMode, playbackPending: id });

        } else if (this.livefeedMode === EmberScannerLivefeedMode.Playback) {
            this.event.emit({ playbackPending: id });
        }

        this.initializeAudio();
        this.syncAudioOutput();
        this.getCall(id, WebsocketCallFlag.Play);
    }

    loadAndPlayHistory(id: number): void {
        if (!id) {
            return;
        }

        if (this.skipDelay) {
            this.skipDelay.unsubscribe();
            this.skipDelay = undefined;
        }

        this.historyPlaybackPending = id;
        this.initializeAudio();
        this.syncAudioOutput();
        this.getCall(id, WebsocketCallFlag.History);
    }

    ngOnDestroy(): void {
        this.destroyed = true;
        this.reconnectTimer?.unsubscribe();
        this.skipDelay?.unsubscribe();
        this.audioCleanup.forEach(cleanup => cleanup());
        this.closeWebsocket();
        this.stop();
        this.audioOutput?.dispose();
        if (this.audioContext) {
            this.audioContext.onstatechange = null;
            void this.audioContext.close().catch(() => undefined);
        }
        if (this.oscillatorContext) {
            void this.oscillatorContext.close().catch(() => undefined);
        }
        if ('mediaSession' in navigator) {
            this.mediaActions.forEach(action => navigator.mediaSession.setActionHandler(action, null));
            navigator.mediaSession.metadata = null;
            navigator.mediaSession.playbackState = 'none';
        }
    }

    pause(status = !this.livefeedPaused): void {
        this.livefeedPaused = status;

        if (status) {
            this.audioOutput?.stop();
            void this.audioContext?.suspend().catch(() => undefined);
        } else {
            this.initializeAudio();
            this.play();
        }

        this.syncAudioOutput();
        this.event.emit({ pause: this.livefeedPaused });
    }

    cycleVolume(): number {
        const levels = [1, .75, .5, .25, 0];
        const currentIndex = levels.indexOf(this.volumeLevel);

        this.volumeLevel = levels[(currentIndex + 1) % levels.length];

        if (this.audioGain) {
            this.audioGain.gain.value = this.volumeLevel;
        }

        return this.volumeLevel;
    }

    play(call?: EmberScannerCall | undefined): void {
        if (this.destroyed) return;
        if (call?.audio) this.initializeAudio();
        if (!this.audioContext || this.livefeedPaused || this.skipDelay) {
            return;

        } else if (call?.audio) {
            if (this.call) {
                this.stop({ emit: false });
            }

            this.call = call;

        } else if (this.call) {
            return;

        } else {
            this.call = this.callQueue.shift();
        }

        this.syncAudioOutput();
        if (!this.call?.audio) {
            return;
        }

        const queue = this.livefeedMode === EmberScannerLivefeedMode.Playback
            ? this.getPlaybackQueueCount()
            : this.callQueue.length;

        const callToPlay = this.call;
        const audio = callToPlay.audio;

        if (!audio) {
            return;
        }

        const decodeGeneration = ++this.audioDecodeGeneration;
        const arrayBuffer = new ArrayBuffer(audio.data.length);
        const arrayBufferView = new Uint8Array(arrayBuffer);

        for (let i = 0; i < audio.data.length; i++) {
            arrayBufferView[i] = audio.data[i];
        }

        this.audioContext?.decodeAudioData(arrayBuffer, async (buffer) => {
            if (!this.audioContext || this.audioSource || this.call !== callToPlay
                || decodeGeneration !== this.audioDecodeGeneration) {
                return;
            }

            await this.playAlert(callToPlay);

            if (!this.audioContext || this.audioSource || this.call !== callToPlay
                || decodeGeneration !== this.audioDecodeGeneration) {
                return;
            }

            this.audioSource = this.audioContext.createBufferSource();
            this.audioSource.buffer = buffer;
            this.audioSource.connect(this.audioGain || this.audioContext.destination);
            this.audioSource.onended = () => this.skip({ delay: true });
            this.audioSource.start();
            this.audioSourceStartTime = this.audioContext.currentTime;

            this.event.emit({ call: callToPlay, queue });

            interval(1000).pipe(takeWhile(() => this.call === callToPlay
                && decodeGeneration === this.audioDecodeGeneration)).subscribe(() => {
                if (this.audioContext && !isNaN(this.audioContext.currentTime)) {
                    if (!this.livefeedPaused) {
                        this.event.emit({ time: this.audioContext.currentTime - this.audioSourceStartTime });
                    }
                }
            });
        }, () => {
            if (this.call !== callToPlay || decodeGeneration !== this.audioDecodeGeneration) {
                return;
            }

            this.event.emit({ call: callToPlay, queue });

            this.skip({ delay: false });
        });
    }

    queue(call: EmberScannerCall, options?: { priority?: boolean }): void {
        if (!call?.audio || this.livefeedMode === EmberScannerLivefeedMode.Offline) {
            return;
        }

        if (options?.priority) {
            this.callQueue.unshift(call);

        } else {
            this.callQueue.push(call);
        }

        if (!this.audioContext || this.audioSource || this.call || this.livefeedPaused || this.skipDelay) {
            this.event.emit({
                queue: this.livefeedMode === EmberScannerLivefeedMode.Online ? this.callQueue.length : this.getPlaybackQueueCount(),
            });

        } else {
            this.play();
        }
    }

    replay(): void {
        this.play(this.call || this.callPrevious);
    }

    readPin(): string | undefined {
        return window?.sessionStorage?.getItem(EmberScannerService.STORAGE_KEY_PIN) || undefined;
    }

    savePin(pin: string): void {
        window?.localStorage?.removeItem(EmberScannerService.STORAGE_KEY_PIN);
        window?.sessionStorage?.setItem(EmberScannerService.STORAGE_KEY_PIN, pin);
    }

    searchCalls(options: EmberScannerSearchOptions, settings?: { append?: boolean }): void {
        this.playbackSearchAppend = settings?.append === true;

        this.sendtoWebsocket(WebsocketCommand.ListCall, options);
    }

    searchHistoryCalls(offset = 0, limit = 30): number {
        const request = ++this.historyRequest;

        this.sendtoWebsocket(WebsocketCommand.ListCall, {
            limit,
            livefeed: true,
            offset,
            request,
            sort: -1,
        }, WebsocketCallFlag.History);

        return request;
    }

    skip(options?: { delay?: boolean }): void {
        const play = () => {
            if (this.livefeedMode === EmberScannerLivefeedMode.Playback) {
                this.playbackNextCall();

            } else {
                this.play();
            }
        };

        this.stop();

        if (options?.delay) {
            this.skipDelay = timer(1000).subscribe(() => {
                this.skipDelay = undefined;

                play();
            });

        } else {
            if (this.skipDelay) {
                this.skipDelay?.unsubscribe();

                this.skipDelay = undefined;
            }

            play();
        }
    }

    startLivefeed(): void {
        this.livefeedMode = EmberScannerLivefeedMode.Online;
        this.livefeedPaused = false;
        this.initializeAudio();
        this.syncAudioOutput();

        this.event.emit({ livefeedMode: this.livefeedMode, pause: false });

        this.syncLivefeedMap();
    }

    stop(options?: { emit?: boolean }): void {
        this.audioDecodeGeneration++;

        if (this.audioSource) {
            this.audioSource.onended = null;
            this.audioSource.stop();
            this.audioSource.disconnect();
            this.audioSource = undefined;
            this.audioSourceStartTime = NaN;
        }

        if (this.call) {
            this.callPrevious = this.call;

            this.call = undefined;
        }

        this.syncAudioOutput();
        if (typeof options?.emit !== 'boolean' || options.emit) {
            this.event.emit({ call: this.call });
        }
    }

    stopLivefeed(): void {
        this.livefeedMode = EmberScannerLivefeedMode.Offline;
        this.historyPlaybackPending = undefined;
        this.playbackPending = undefined;
        this.skipDelay?.unsubscribe();
        this.skipDelay = undefined;

        this.clearQueue();

        this.event.emit({ livefeedMode: this.livefeedMode, queue: 0 });

        this.stop();

        this.syncLivefeedMap();
    }

    stopPlaybackMode(): void {
        this.livefeedMode = EmberScannerLivefeedMode.Offline;
        this.historyPlaybackPending = undefined;
        this.playbackPending = undefined;
        this.skipDelay?.unsubscribe();
        this.skipDelay = undefined;

        this.playbackRefreshing = false;

        this.clearQueue();

        this.event.emit({ livefeedMode: this.livefeedMode, queue: 0 });

        this.stop();
    }

    toggleCategory(category: EmberScannerCategory): void {
        const clearTimer = (lfm: EmberScannerLivefeed): void => {
            lfm.minutes = 0;
            lfm.timer?.unsubscribe();
            lfm.timer = undefined;
        };

        if (category) {
            if (this.livefeedMapPriorToHoldSystem) {
                this.cancelLivefeedTimers(this.livefeedMapPriorToHoldSystem);
                this.livefeedMapPriorToHoldSystem = undefined;
            }

            if (this.livefeedMapPriorToHoldTalkgroup) {
                this.cancelLivefeedTimers(this.livefeedMapPriorToHoldTalkgroup);
                this.livefeedMapPriorToHoldTalkgroup = undefined;
            }

            const status = category.status === EmberScannerCategoryStatus.On ? false : true;

            this.config?.systems.forEach((sys) => {
                sys.talkgroups?.forEach((tg) => {
                    const lfm = this.livefeedMap[sys.id][tg.id];

                    if (category.type == EmberScannerCategoryType.Group && tg.groups.includes(category.label)) {
                        clearTimer(lfm);
                        lfm.active = status;

                    } else if (category.type == EmberScannerCategoryType.Tag && tg.tag === category.label) {
                        clearTimer(lfm);
                        lfm.active = status;
                    }
                });
            });

            this.rebuildCategories();

            this.syncLivefeedMap();

            this.saveLivefeedMap();

            this.cleanQueue();

            this.event.emit({
                categories: this.categories,
                holdSys: false,
                holdTg: false,
                map: this.livefeedMap,
                queue: this.callQueue.length,
            });
        }
    }

    private bootstrapAudio(): void {
        const gesture = () => {
            this.initializeAudio();
            if (this.wantsAudioPlayback) this.syncAudioOutput();
        };
        const recover = () => {
            if (this.destroyed || this.document.visibilityState === 'hidden') return;
            if (this.wantsAudioPlayback) this.syncAudioOutput();
            if (this.websocket?.readyState === WebSocket.CLOSED) this.reconnectWebsocket();
        };

        for (const event of ['keydown', 'mousedown', 'touchstart']) {
            this.document.body.addEventListener(event, gesture, { passive: true });
            this.audioCleanup.push(() => this.document.body.removeEventListener(event, gesture));
        }
        this.document.addEventListener('visibilitychange', recover);
        window.addEventListener('pageshow', recover);
        window.addEventListener('online', recover);
        this.audioCleanup.push(() => {
            this.document.removeEventListener('visibilitychange', recover);
            window.removeEventListener('pageshow', recover);
            window.removeEventListener('online', recover);
        });
    }

    private initializeAudio(): void {
        if (this.destroyed) return;
        try {
            const audioSession = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
            if (audioSession) audioSession.type = 'playback';
        } catch (error) {
            console.warn('Unable to configure the playback audio session', error);
        }

        if (!this.audioContext) {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'playback' });
            this.audioOutput = new ScannerAudioOutput(this.audioContext, this.document, () => this.pause(true));
            this.audioGain = this.audioContext.createGain();
            this.audioGain.gain.value = this.volumeLevel;
            this.audioGain.connect(this.audioOutput.destination);
            this.audioContext.onstatechange = () => {
                // Recover once per state change. Do not recursively retry a blocked resume.
                if (this.wantsAudioPlayback && this.audioContext?.state === 'suspended') {
                    void this.audioOutput?.start();
                }
            };
            this.installMediaControls();
        }
        // Button feedback remains available when radio playback is paused or off.
        if (!this.oscillatorContext) {
            this.oscillatorContext = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
        }
        if (this.oscillatorContext.state !== 'running') {
            void this.oscillatorContext.resume().catch(() => undefined);
        }
    }

    private get wantsAudioPlayback(): boolean {
        return !this.destroyed && !this.livefeedPaused && (this.livefeedMode !== EmberScannerLivefeedMode.Offline
            || !!this.call || this.historyPlaybackPending !== undefined);
    }

    private syncAudioOutput(): void {
        if (this.wantsAudioPlayback) void this.audioOutput?.start();
        else this.audioOutput?.stop();

        if (!('mediaSession' in navigator)) return;
        const hasPlayback = !this.destroyed && (this.livefeedMode !== EmberScannerLivefeedMode.Offline || !!this.call);
        navigator.mediaSession.playbackState = hasPlayback ? (this.livefeedPaused ? 'paused' : 'playing') : 'none';
        if (!hasPlayback) {
            navigator.mediaSession.metadata = null;
        } else if ('MediaMetadata' in window) {
            navigator.mediaSession.metadata = new MediaMetadata({
                title: this.call?.talkgroupData?.name || this.call?.talkgroupData?.label || this.config.branding || 'Ember Scanner',
                artist: this.call?.systemData?.label || this.config.brandingSubheading || 'Live Feed',
                album: 'Ember Scanner',
            });
        }
    }

    private installMediaControls(): void {
        if (!('mediaSession' in navigator)) return;
        const handlers: [MediaSessionAction, () => void][] = [
            ['play', () => {
                if (this.livefeedMode === EmberScannerLivefeedMode.Offline && !this.call) this.startLivefeed();
                else this.pause(false);
            }],
            ['pause', () => this.pause(true)],
            ['stop', () => this.livefeedMode === EmberScannerLivefeedMode.Online ? this.stopLivefeed() : this.stopPlaybackMode()],
        ];
        for (const [action, handler] of handlers) {
            try {
                navigator.mediaSession.setActionHandler(action, handler);
                this.mediaActions.push(action);
            } catch {
                // Individual remote-control actions are not supported by every browser.
            }
        }
    }

    private cleanQueue(): void {
        const isActive = (call: EmberScannerCall) => {
            const lfm = (sys: number, tg: number): boolean => this.livefeedMap && this.livefeedMap[sys] && this.livefeedMap[sys][tg]?.active;
            let active = lfm(call.system, call.talkgroup);
            if (!active && Array.isArray(call.patches)) {
                for (let i = 0; i < call.patches.length; i++) {
                    active = lfm(call.system, call.patches[i]);
                    if (active) {
                        break;
                    }
                }
            }
            return active;
        };

        this.callQueue = this.callQueue.filter((call: EmberScannerCall) => isActive(call));

        if (this.call && !isActive(this.call)) {
            this.skip();
        }
    }

    private cancelLivefeedTimers(map: EmberScannerLivefeedMap): void {
        Object.keys(map).forEach((system) => {
            Object.keys(map[+system]).forEach((talkgroup) => {
                const livefeed = map[+system][+talkgroup];

                livefeed.timer?.unsubscribe();
                livefeed.timer = undefined;
                livefeed.minutes = undefined;
            });
        });
    }

    private clearQueue(): void {
        this.callQueue.splice(0, this.callQueue.length);
    }

    private closeWebsocket(): void {
        if (this.websocket instanceof WebSocket) {
            this.websocket.onclose = null;
            this.websocket.onerror = null;
            this.websocket.onmessage = null;
            this.websocket.onopen = null;

            this.websocket.close();

            this.websocket = undefined;
        }
    }

    private download(call: EmberScannerCall): void {
        if (call.audio) {
            const file = call.audio.data.reduce((str, val) => str += String.fromCharCode(val), '');
            const fileName = call.audioName || 'unknown.dat';
            const fileType = call.audioType || 'audio/*';
            const fileUri = `data:${fileType};base64,${window.btoa(file)}`;

            const el = this.document.createElement('a');

            el.style.display = 'none';

            el.setAttribute('href', fileUri);
            el.setAttribute('download', fileName);

            this.document.body.appendChild(el);

            el.click();

            this.document.body.removeChild(el);
        }
    }

    private getCall(id: number, flags?: WebsocketCallFlag): void {
        this.sendtoWebsocket(WebsocketCommand.Call, `${id}`, flags);
    }

    private getPlaybackQueueCount(id = this.call?.id || this.callPrevious?.id): number {
        let queueCount = 0;

        if (id && this.playbackList) {
            const index = this.playbackList.results.findIndex((call) => call.id === id);

            if (index !== -1) {
                if (this.playbackList.options.sort === -1) {
                    queueCount = this.playbackList.options.offset + index;

                } else {
                    queueCount = this.playbackList.count - this.playbackList.options.offset - index - 1;
                }
            }
        }

        return queueCount;
    }

    private initializeInstanceId(): void {
        this.instanceId = this.router.parseUrl(this.router.url).queryParams['id'] || this.instanceId;
    }

    private openWebsocket(): void {
        const websocketUrl = window.location.href.replace(/^http/, 'ws');

        this.websocket = new WebSocket(websocketUrl);

        this.websocket.onclose = (ev: CloseEvent) => {
            this.event.emit({ linked: false });

            if (ev.code !== 1000) {
                this.reconnectTimer?.unsubscribe();
                this.reconnectTimer = timer(2000).subscribe(() => this.reconnectWebsocket());
            }
        };

        this.websocket.onopen = () => {
            this.event.emit({ linked: true });

            if (this.websocket instanceof WebSocket) {
                this.websocket.onmessage = (ev: MessageEvent) => this.parseWebsocketMessage(ev.data);
            }

            this.sendtoWebsocket(WebsocketCommand.Version);
            this.sendtoWebsocket(WebsocketCommand.Config);
        };
    }

    private parseWebsocketMessage(message: string): void {
        try {
            message = JSON.parse(message);

        } catch (error) {
            console.warn(`Invalid control message received, ${error}`);
        }

        if (Array.isArray(message)) {
            switch (message[0]) {
                case WebsocketCommand.Call:
                    if (message[1] !== null) {
                        const call: EmberScannerCall = message[1];
                        const flag: string = message[2];

                        if (flag === WebsocketCallFlag.Download) {
                            this.download(message[1]);

                        } else if (flag === WebsocketCallFlag.History) {
                            if (call.id === this.historyPlaybackPending) {
                                this.historyPlaybackPending = undefined;
                                this.play(this.transformCall(call));
                            }

                        } else if (flag === WebsocketCallFlag.Play && call.id === this.playbackPending) {
                            this.playbackPending = undefined;

                            this.queue(this.transformCall(call), { priority: true });

                        } else {
                            const incomingCall = this.transformCall(call);

                            this.event.emit({ incomingCall });
                            this.queue(incomingCall);
                        }
                    }

                    break;

                case WebsocketCommand.Activity:
                    this.activityResponses.next({ id: message[2], data: message[1] });
                    break;

                case WebsocketCommand.Config: {
                    const config = message[1];

                    this.config = {
                        alerts: config.alerts,
                        branding: typeof config.branding === 'string' ? config.branding : '',
                        brandingSubheading: typeof config.brandingSubheading === 'string' ? config.brandingSubheading : '',
                        dimmerDelay: typeof config.dimmerDelay === 'number' ? config.dimmerDelay : 5000,
                        email: typeof config.email === 'string' ? config.email : '',
                        groups: typeof config.groups !== null && typeof config.groups === 'object' ? config.groups : {},
                        groupsData: Array.isArray(config.groupsData) ? config.groupsData : [],
                        keypadBeeps: config.keypadBeeps !== null && typeof config.keypadBeeps === 'object' ? config.keypadBeeps : {},
                        playbackGoesLive: typeof config.playbackGoesLive === 'boolean' ? config.playbackGoesLive : false,
                        showErrorsAndSpikes: typeof config.showErrorsAndSpikes === 'boolean' ? config.showErrorsAndSpikes : true,
                        showListenersCount: typeof config.showListenersCount === 'boolean' ? config.showListenersCount : false,
                        systems: Array.isArray(config.systems) ? config.systems.slice() : [],
                        tags: typeof config.tags !== null && typeof config.tags === 'object' ? config.tags : {},
                        tagsData: Array.isArray(config.tagsData) ? config.tagsData : [],
                        time12hFormat: typeof config.time12hFormat === 'boolean' ? config.time12hFormat : false,
                    };

                    this.rebuildLivefeedMap();

                    // Keep receiving metadata for selected talkgroups in every mode.
                    // The local audio queue still decides whether calls are played.
                    this.syncLivefeedMap();

                    this.event.emit({
                        auth: false,
                        categories: this.categories,
                        config: this.config,
                        holdSys: !!this.livefeedMapPriorToHoldSystem,
                        holdTg: !!this.livefeedMapPriorToHoldTalkgroup,
                        map: this.livefeedMap,
                    });

                    break;
                }

                case WebsocketCommand.Expired:
                    this.event.emit({ auth: true, expired: true });

                    break;

                case WebsocketCommand.ListCall: {
                    if (message[2] === WebsocketCallFlag.History) {
                        const historyList: EmberScannerPlaybackList | undefined = message[1];

                        if (historyList) {
                            historyList.results = historyList.results.map((call) => this.transformCall(call));
                        }

                        this.event.emit({ historyList });
                        break;
                    }

                    const previousPlaybackList = this.playbackList;
                    const incomingPlaybackList: EmberScannerPlaybackList | undefined = message[1];

                    this.playbackList = incomingPlaybackList;

                    if (this.playbackSearchAppend && previousPlaybackList && incomingPlaybackList) {
                        const existingIds = new Set(previousPlaybackList.results.map((call) => call.id));
                        const appendedResults = incomingPlaybackList.results.filter((call) => !existingIds.has(call.id));
                        const results = previousPlaybackList.results.concat(appendedResults);

                        this.playbackList = {
                            ...incomingPlaybackList,
                            options: {
                                ...incomingPlaybackList.options,
                                limit: results.length,
                                offset: 0,
                            },
                            results,
                        };
                    }

                    this.playbackSearchAppend = false;

                    if (this.playbackList) {
                        this.playbackList.results = this.playbackList.results.map((call) => this.transformCall(call));

                        this.event.emit({ playbackList: this.playbackList });

                        if (this.livefeedMode === EmberScannerLivefeedMode.Playback) {
                            this.playbackNextCall();
                        }
                    }

                    break;
                }

                case WebsocketCommand.ListenersCount:
                    this.event.emit({ listeners: message[1] });

                    break;

                case WebsocketCommand.Max:
                    this.event.emit({ auth: true, tooMany: true });

                    break;

                case WebsocketCommand.Pin:
                    this.event.emit({ auth: true });

                    break;

                case WebsocketCommand.PinLocked:
                    this.event.emit({
                        auth: true,
                        locked: true,
                        retryAfter: typeof message[1] === 'number' ? message[1] : undefined,
                    });

                    break;

                case WebsocketCommand.Version: {
                    const data = message[1];

                    if (data !== null && typeof data === 'object') {
                        const branding = data['branding'];
                        const brandingSubheading = data['brandingSubheading'];
                        const email = data['email'];

                        if (typeof branding === 'string') {
                            this.config.branding = branding;
                        }

                        this.config.brandingSubheading = typeof brandingSubheading === 'string' ? brandingSubheading : '';

                        if (typeof email === 'string') {
                            this.config.email = email;
                        }

                        if (this.config.branding || this.config.email || typeof brandingSubheading === 'string') {
                            this.event.emit({ config: this.config });
                        }
                    }

                    break;
                }
            }
        }
    }

    private async playAlert(call: EmberScannerCall): Promise<void> {
        if (this.config.alerts) {
            let alert: string | undefined;

            call?.talkgroupData?.groups.some((label) => {
                const group = this.config.groupsData?.find((group) => group.label == label);

                if (group && group.alert) {
                    alert = group.alert;

                    return true;
                }

                return false;
            });

            if (!alert) {
                const tag = this.config.tagsData?.find((tag) => tag.label == call.talkgroupData?.tag);

                if (tag && tag.alert) alert = tag.alert;
            }

            if (!alert) alert = call.systemData?.alert;

            if (!alert) alert = call.talkgroupData?.alert;

            if (alert) await this.playOscillatorSequence(this.config.alerts[alert], true);
            console.log(alert);
        }
    }

    private playbackNextCall(): void {
        if (this.call || this.livefeedMode !== EmberScannerLivefeedMode.Playback || !this.playbackList || this.playbackPending) {
            return;
        }

        const index = this.playbackList.results.findIndex((call) => call.id === this.callPrevious?.id);

        if (this.playbackList.options.sort === -1) {
            if (index === -1) {
                this.loadAndPlay(this.playbackList.results[this.playbackList.results.length - 1].id);

            } else if (index === 0) {
                if (this.playbackList.options.offset < this.playbackList.options.limit) {
                    if (this.playbackRefreshing) {
                        this.stopPlaybackMode();

                        if (this.config.playbackGoesLive) {
                            this.startLivefeed();
                        }

                    } else {
                        this.playbackRefreshing = true;
                        this.searchCalls(this.playbackList.options);
                    }

                } else {
                    this.searchCalls(Object.assign({}, this.playbackList.options, {
                        offset: this.playbackList.options.offset - this.playbackList.options.limit,
                    }));
                }

            } else {
                this.loadAndPlay(this.playbackList.results[index - 1].id);
            }

        } else {
            if (index === -1) {
                this.loadAndPlay(this.playbackList.results[0].id);

            } else if (index === this.playbackList.results.length - 1) {
                if (this.playbackList.options.offset < (this.playbackList.count - this.playbackList.options.limit)) {
                    this.searchCalls(Object.assign({}, this.playbackList.options, {
                        offset: this.playbackList.options.offset + this.playbackList.options.limit,
                    }));

                } else if (this.playbackRefreshing) {
                    this.stopPlaybackMode();

                    if (this.config.playbackGoesLive) {
                        this.startLivefeed();
                    }

                } else {
                    this.playbackRefreshing = true;
                    this.searchCalls(this.playbackList.options);
                }

            } else {
                this.loadAndPlay(this.playbackList.results[index + 1].id);
            }
        }
    }

    private playOscillatorSequence(seq: EmberScannerOscillatorData[], forCall = false): Promise<void> {
        return new Promise((resolve) => {
            const context = forCall ? this.audioContext : this.oscillatorContext;

            if (!context || !seq?.length) {
                resolve();

                return;
            }

            const gn = context.createGain();

            gn.gain.value = forCall ? .1 : .1 * this.volumeLevel;

            gn.connect(forCall && this.audioGain ? this.audioGain : context.destination);

            seq.forEach((data, index) => {
                const osc = context.createOscillator();

                osc.connect(gn);

                osc.frequency.value = data.frequency;

                osc.type = data.type;

                if (index === seq.length - 1) {
                    osc.onended = () => resolve();
                }

                osc.start(context.currentTime + data.begin);

                osc.stop(context.currentTime + data.end);
            });
        });
    }

    private readLivefeedMap(): void {
        try {
            let lfm: { [key: number]: { [key: number]: boolean } } = {};

            let store = window?.localStorage?.getItem(`${EmberScannerService.LOCAL_STORAGE_KEY_LFM}-${this.instanceId}`);

            if (store !== null) {
                lfm = JSON.parse(store);

            } else {
                store = window?.localStorage?.getItem(EmberScannerService.LOCAL_STORAGE_KEY_LEGACY);

                if (store !== null) {
                    lfm = JSON.parse(store);
                }
            }

            Object.keys(lfm ?? {}).forEach((sys: string) => {
                Object.keys(lfm[+sys]).forEach((tg) => {
                    if (!this.livefeedMap[+sys]) this.livefeedMap[+sys] = {};
                    if (!this.livefeedMap[+sys][+tg]) this.livefeedMap[+sys][+tg] = {} as EmberScannerLivefeed;
                    this.livefeedMap[+sys][+tg].active = lfm[+sys][+tg];
                });
            });

        } catch (_) {
            //
        }
    }

    private clearStoredState(): void {
        const keys: string[] = [];

        for (let index = 0; index < window.localStorage.length; index++) {
            const key = window.localStorage.key(index);
            if (key === EmberScannerService.LOCAL_STORAGE_KEY_LEGACY
                || key === EmberScannerService.STORAGE_KEY_PIN
                || key?.startsWith(`${EmberScannerService.LOCAL_STORAGE_KEY_LFM}-`)) {
                keys.push(key);
            }
        }

        keys.forEach((key) => window.localStorage.removeItem(key));
        window.sessionStorage.removeItem(EmberScannerService.STORAGE_KEY_PIN);
    }

    private rebuildCategories(): void {
        this.categories = Object.keys(this.config.groups || []).map((label) => {
            const allOff = Object.keys(this.config.groups[label]).map((sys) => +sys)
                .every((sys: number) => this.config.groups[label] && this.config.groups[label][sys]
                    .every((tg) => this.livefeedMap[sys] && !this.livefeedMap[sys][tg].active));

            const allOn = Object.keys(this.config.groups[label]).map((sys) => +sys)
                .every((sys: number) => this.config.groups[label] && this.config.groups[label][sys]
                    .every((tg) => this.livefeedMap[sys] && this.livefeedMap[sys][tg].active));

            const status = allOff ? EmberScannerCategoryStatus.Off : allOn ? EmberScannerCategoryStatus.On : EmberScannerCategoryStatus.Partial;

            return { label, status, type: EmberScannerCategoryType.Group };
        })

        this.categories.sort((a, b) => a.label.localeCompare(b.label));
    }

    private rebuildLivefeedMap(): void {
        const lfm = this.config.systems.reduce((sysMap, sys) => {
            sysMap[sys.id] = sys.talkgroups.reduce((tgMap, tg) => {
                const group = this.categories.find((cat) => tg.groups.includes(cat.label));
                const tag = this.categories.find((cat) => cat.label === tg.tag);

                tgMap[tg.id] = (this.livefeedMap[sys.id] && this.livefeedMap[sys.id][tg.id])
                    ? this.livefeedMap[sys.id][tg.id]
                    : {
                        active: !(group?.status === EmberScannerCategoryStatus.Off || tag?.status === EmberScannerCategoryStatus.Off),
                    } as EmberScannerLivefeed;

                return tgMap;
            }, sysMap[sys.id] || {} as { [key: number]: EmberScannerLivefeed });
            return sysMap;
        }, {} as EmberScannerLivefeedMap);

        if (this.livefeedMapPriorToHoldSystem != null) {
            this.livefeedMapPriorToHoldSystem = lfm;
        } else if (this.livefeedMapPriorToHoldTalkgroup != null) {
            this.livefeedMapPriorToHoldTalkgroup = lfm;
        } else {
            this.livefeedMap = lfm;
        }

        this.saveLivefeedMap();

        this.rebuildCategories();
    }

    private reconnectWebsocket(): void {
        if (this.destroyed) return;
        this.reconnectTimer?.unsubscribe();
        this.reconnectTimer = undefined;
        this.closeWebsocket();

        this.openWebsocket();
    }

    private saveLivefeedMap(map = this.livefeedMap): void {
        const lfm = Object.keys(map).reduce((sysMap: { [key: number]: { [key: number]: boolean } }, sys: string) => {
            sysMap[+sys] = Object.keys(map[+sys]).reduce((tgMap: { [key: number]: boolean }, tg: string) => {
                tgMap[+tg] = map[+sys][+tg].active;
                return tgMap;
            }, {});
            return sysMap;
        }, {});

        window?.localStorage?.setItem(`${EmberScannerService.LOCAL_STORAGE_KEY_LFM}-${this.instanceId}`, JSON.stringify(lfm));
    }

    private syncLivefeedMap(): void {
        const lfm = Object.keys(this.livefeedMap).reduce((sysMap: { [key: number]: { [key: number]: boolean } }, sys) => {
            sysMap[+sys] = Object.keys(this.livefeedMap[+sys]).reduce((tgMap: { [key: number]: boolean }, tg: string) => {
                tgMap[+tg] = this.livefeedMap[+sys][+tg].active;
                return tgMap;
            }, {});
            return sysMap;
        }, {});

        this.sendtoWebsocket(WebsocketCommand.LivefeedMap, lfm);
    }

    private sendtoWebsocket(command: string, payload?: unknown, flags?: string): void {
        if (this.websocket?.readyState === 1) {
            const message: unknown[] = [command];

            if (payload) {
                message.push(payload);
            }

            if (flags !== null && flags !== undefined) {
                message.push(flags);
            }

            this.websocket.send(JSON.stringify(message));
        }
    }


    private transformCall(call: EmberScannerCall): EmberScannerCall {
        if (call && Array.isArray(this.config?.systems)) {
            call.systemData = this.config.systems.find((system) => system.id === call.system);

            if (Array.isArray(call.systemData?.talkgroups)) {
                call.talkgroupData = call.systemData?.talkgroups.find((talkgroup) => talkgroup.id === call.talkgroup);

                const patchRefs = [...new Set((call.patches || []).filter((talkgroup) => talkgroup > 0 && talkgroup !== call.talkgroup))];
                call.patchTalkgroupData = patchRefs
                    .map((talkgroup) => call.systemData?.talkgroups.find((candidate) => candidate.id === talkgroup))
                    .filter((talkgroup): talkgroup is NonNullable<typeof talkgroup> => talkgroup !== undefined);
            }

            if (call.talkgroupData?.frequency) {
                call.frequency = call.talkgroupData.frequency;
            }

            call.groupsData = this.config.groupsData.filter((gd) => call.talkgroupData?.groups.some((l) => l === gd.label));

            call.tagData = this.config.tagsData.find((td) => td.label === call.talkgroupData?.tag);
        }

        return call;
    }
}
