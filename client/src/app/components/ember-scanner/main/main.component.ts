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

import { ChangeDetectorRef, Component, EventEmitter, OnDestroy, OnInit, Output } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Subscription, timer } from 'rxjs';
import packageInfo from '../../../../../package.json';
import {
    EmberScannerAvoidOptions,
    EmberScannerBeepStyle,
    EmberScannerCall,
    EmberScannerConfig,
    EmberScannerEvent,
    EmberScannerLivefeedMap,
    EmberScannerLivefeedMode,
} from '../ember-scanner';
import { EmberScannerService } from '../ember-scanner.service';
import { EmberScannerSupportComponent } from './support/support.component';

@Component({
    selector: 'ember-scanner-main',
    styleUrls: [
        '../common.scss',
        './main.component.scss',
    ],
    templateUrl: './main.component.html',
    standalone: false
})
export class EmberScannerMainComponent implements OnDestroy, OnInit {
    auth = false;
    pinError = '';
    pinPending = false;

    avoided = false;

    branding = '';

    call: EmberScannerCall | undefined;
    callDate: Date | undefined;
    callError = '0';
    callFrequency: string = this.formatFrequency(0);
    callGroup = 'Group';
    callHistory: EmberScannerCall[] = [];
    callPrevious: EmberScannerCall | undefined;
    callProgress = new Date(0, 0, 0, 0, 0, 0);
    callQueue = 0;
    callSpike = '0';
    callSystem = 'System';
    callTag = 'Tag';
    callTalkgroup = 'Talkgroup';
    callTalkgroupId = '0';

    //
    // BEGIN OF RED TAPE:
    //
    // By modifying, deleting or disabling the following lines, you harm
    // the open source project and its author.  Ember Scanner represents a lot of
    // investment in time, support, testing and hardware.
    //
    // Be respectful, sponsor the project, use native apps when possible.
    //
    callTalkgroupName = `Ember Scanner v${packageInfo.version}`;
    //
    // END OF RED TAPE.
    //

    callTime = 0;
    callUnit = '0';

    clock = new Date();

    delayed = false;

    dimmer = false;

    email = '';

    holdSys = false;
    holdTg = false;

    ledStyle = '';

    linked = false;

    listeners = 0;

    livefeedOffline = true;
    livefeedOnline = false;
    livefeedPaused = false;

    map: EmberScannerLivefeedMap = {};

    patched = false;

    playbackMode = false;

    replayOffset = 0;
    replayTimer: Subscription | undefined;

    selectedHistoryCallId: number | undefined;

    get visibleCallHistory(): (EmberScannerCall | undefined)[] {
        const selectedIndex = this.callHistory.findIndex((call) => call.id === this.selectedHistoryCallId);
        const maxStart = Math.max(0, this.callHistory.length - 5);
        const start = selectedIndex < 5 ? 0 : Math.min(maxStart, selectedIndex - 2);
        const rows: (EmberScannerCall | undefined)[] = this.callHistory.slice(start, start + 5);

        while (rows.length < 5) {
            rows.push(undefined);
        }

        return rows;
    }

    tempAvoid = 0;

    timeFormat = 'HH:mm';

    type = '';

    volumeLevel = 100;

    get showListenersCount(): boolean {
        return this.config?.showListenersCount || false;
    }

    @Output() openSearchPanel = new EventEmitter<void>();

    @Output() toggleFullscreen = new EventEmitter<void>();

    private clockTimer: Subscription | undefined;

    private config: EmberScannerConfig | undefined;

    private dimmerTimer: Subscription | undefined;

    private eventSubscription;

    private historyCount = 0;

    private historyLoading = false;

    private historyReplacePending = false;

    private historyRequest = 0;

    private pendingHistoryIndex: number | undefined;

    private pendingPin = '';

    constructor(
        private emberScannerService: EmberScannerService,
        private matSnackBar: MatSnackBar,
        private ngChangeDetectorRef: ChangeDetectorRef,
    ) {
        this.eventSubscription = this.emberScannerService.event.subscribe((event: EmberScannerEvent) => this.eventHandler(event));
    }

    authenticate(pin: string): void {
        if (!/^[0-9]+$/.test(pin)) {
            this.pinError = 'NUMBERS ONLY';
            this.emberScannerService.beep(EmberScannerBeepStyle.Denied);
            return;
        }

        this.pendingPin = pin;
        this.pinError = '';
        this.pinPending = true;
        this.emberScannerService.authenticate(pin);
    }

    authFocus(): void {
        // The dedicated PIN screen handles keypad and physical-keyboard input.
    }

    clearPinError(): void {
        this.pinError = '';
    }

    avoid(options?: EmberScannerAvoidOptions): void {
        const call = this.call || this.callPrevious;

        if (this.auth) {
            this.authFocus();

        } else if (options || call) {
            if (options) {
                this.emberScannerService.avoid(options);
            } else if (call) {
                const avoided = this.emberScannerService.isAvoided(call);
                const minutes = this.emberScannerService.isAvoidedTimer(call);

                if (!avoided) {
                    this.emberScannerService.avoid({ status: false });
                } else if (!minutes) {
                    this.emberScannerService.avoid({ minutes: 30, status: false });
                } else if (minutes === 30) {
                    this.emberScannerService.avoid({ minutes: 60, status: false });
                } else if (minutes === 60) {
                    this.emberScannerService.avoid({ minutes: 120, status: false });
                } else {
                    this.emberScannerService.avoid({ status: true });
                }
            }

            if (call && this.emberScannerService.isAvoided(call)) {
                this.emberScannerService.beep(EmberScannerBeepStyle.Activate);
            } else {
                this.emberScannerService.beep(EmberScannerBeepStyle.Deactivate);
            }

            this.updateDimmer();

        } else {
            this.emberScannerService.beep(EmberScannerBeepStyle.Denied);
        }

    }

    holdSystem(): void {
        if (this.auth) {
            this.authFocus();

        } else {
            if (this.call || this.callPrevious) {
                this.emberScannerService.beep(this.holdSys ? EmberScannerBeepStyle.Deactivate : EmberScannerBeepStyle.Activate);

                this.emberScannerService.holdSystem();

            } else {
                this.emberScannerService.beep(EmberScannerBeepStyle.Denied);
            }

            this.updateDimmer();
        }
    }

    holdTalkgroup(): void {
        if (this.auth) {
            this.authFocus();

        } else {
            if (this.call || this.callPrevious) {
                this.emberScannerService.beep(this.holdTg ? EmberScannerBeepStyle.Deactivate : EmberScannerBeepStyle.Activate);

                this.emberScannerService.holdTalkgroup();

            } else {
                this.emberScannerService.beep(EmberScannerBeepStyle.Denied);
            }

            this.updateDimmer();
        }
    }

    livefeed(): void {
        if (this.auth) {
            this.authFocus();

        } else {
            this.emberScannerService.beep(this.livefeedOffline ? EmberScannerBeepStyle.Activate : EmberScannerBeepStyle.Deactivate);

            this.emberScannerService.livefeed();

            this.updateDimmer();
        }
    }

    ngOnDestroy(): void {
        this.clockTimer?.unsubscribe();
        this.dimmerTimer?.unsubscribe();
        this.replayTimer?.unsubscribe();

        this.eventSubscription.unsubscribe();
    }

    ngOnInit(): void {
        this.syncClock();
    }

    pause(): void {
        if (this.auth) {
            this.authFocus();

        } else {
            if (this.livefeedPaused) {
                this.emberScannerService.beep(EmberScannerBeepStyle.Deactivate);

                this.emberScannerService.pause();

            } else {
                this.emberScannerService.beep(EmberScannerBeepStyle.Activate);

                this.emberScannerService.pause();
            }

            this.updateDimmer();
        }
    }

    replay(): void {
        if (this.auth) {
            this.authFocus();

        } else {
            if (!this.livefeedPaused && (this.call || this.callPrevious)) {
                this.emberScannerService.beep(EmberScannerBeepStyle.Activate);

                this.selectedHistoryCallId = this.callHistory[0]?.id;

                if (this.replayTimer instanceof Subscription) {
                    this.replayTimer.unsubscribe();
                    this.replayOffset = Math.min(this.callHistory.length, this.replayOffset + 1);
                }

                this.replayTimer = timer(1000).subscribe(() => {
                    this.replayTimer = undefined;
                    this.replayOffset = 0;
                });

                if (this.call && !this.replayOffset) {
                    this.emberScannerService.replay()
                } else if (this.callPrevious !== this.callHistory[0]) {
                    if (this.replayOffset) {
                        this.emberScannerService.play(this.callHistory[this.replayOffset - 1]);
                    } else {
                        this.emberScannerService.replay()
                    }
                } else if (this.replayOffset < this.callHistory.length) {
                    this.emberScannerService.play(this.callHistory[this.replayOffset]);
                }

            } else {
                this.emberScannerService.beep(EmberScannerBeepStyle.Denied);
            }

            this.updateDimmer();
        }
    }

    playHistory(direction: -1 | 1): void {
        if (this.auth) {
            this.authFocus();

            return;
        }

        if (this.livefeedPaused) {
            this.emberScannerService.beep(EmberScannerBeepStyle.Denied);

            return;
        }

        if (!this.callHistory.length) {
            this.pendingHistoryIndex = 0;
            this.requestMoreHistory();
            return;
        }

        const currentIndex = this.callHistory.findIndex((call) => call.id === this.selectedHistoryCallId);
        const selectedIndex = currentIndex < 0
            ? 0
            : Math.max(0, currentIndex + direction);

        if (selectedIndex >= this.callHistory.length) {
            if (this.callHistory.length < this.historyCount) {
                this.pendingHistoryIndex = selectedIndex;
                this.requestMoreHistory();
            } else {
                this.emberScannerService.beep(EmberScannerBeepStyle.Denied);
            }

            return;
        }

        this.selectHistoryCall(selectedIndex);
    }

    historyNumber(call: EmberScannerCall | undefined): number | undefined {
        const index = call ? this.callHistory.findIndex((item) => item.id === call.id) : -1;

        return index >= 0 ? index + 1 : undefined;
    }

    showHelp(): void {
        this.matSnackBar.openFromComponent(EmberScannerSupportComponent, {
            data: { email: this.email },
        });
    }

    showSearchPanel(): void {
        if (!this.config) {
            return;
        }

        if (this.auth) {
            this.authFocus();

        } else {
            this.emberScannerService.beep();

            this.openSearchPanel.emit();
        }
    }

    skip(options?: { delay?: boolean }): void {
        if (this.auth) {
            this.authFocus();

        } else {
            this.emberScannerService.beep(EmberScannerBeepStyle.Activate);

            this.emberScannerService.skip(options);

            this.updateDimmer();
        }
    }

    stop(): void {
        this.emberScannerService.stop();
    }

    cycleVolume(): void {
        this.volumeLevel = Math.round(this.emberScannerService.cycleVolume() * 100);

        this.emberScannerService.beep(EmberScannerBeepStyle.Activate);

        this.updateDimmer();
    }

    toggleFullscreenButton(): void {
        if (this.auth) {
            this.authFocus();

            return;
        }

        this.emberScannerService.beep(EmberScannerBeepStyle.Activate);
        this.toggleFullscreen.emit();

        this.updateDimmer();
    }

    private eventHandler(event: EmberScannerEvent): void {
        if ('auth' in event && event.auth) {
            const pin = this.emberScannerService.readPin();

            if (pin && /^[0-9]+$/.test(pin)) {
                this.emberScannerService.clearPin();
                this.pendingPin = pin;
                this.pinPending = true;
                this.emberScannerService.authenticate(pin);

            } else {
                if (pin) {
                    this.emberScannerService.clearPin();
                }

                this.auth = true;

                if (this.pinPending && !event.expired && !event.locked && !event.tooMany) {
                    this.pinError = 'INVALID CODE — TRY AGAIN';
                    this.emberScannerService.beep(EmberScannerBeepStyle.Denied);
                }

                this.pinPending = false;
                this.pendingPin = '';
            }
        }

        if ('call' in event) {
            if (this.call) {
                this.callPrevious = this.call;

                this.call = undefined;
            }

            if (event.call) {
                const incomingCall = event.call;

                this.call = incomingCall;
                this.upsertHistoryCall(incomingCall);

                this.updateDimmer(true);
            } else {
                this.updateDimmer();
            }
        }

        if (event.incomingCall) {
            this.upsertHistoryCall(event.incomingCall);

            if (this.livefeedOffline) {
                this.callPrevious = event.incomingCall;
                this.updateDimmer();
            }
        }

        if ('config' in event) {
            this.config = event.config;

            this.branding = this.config?.branding ?? '';

            this.email = this.config?.email ?? '';

            this.timeFormat = this.config?.time12hFormat ? 'h:mm a' : 'HH:mm';

            if (this.pendingPin) {
                this.emberScannerService.savePin(this.pendingPin);
            }

            this.auth = false;
            this.pinError = '';
            this.pinPending = false;
            this.pendingPin = '';

        }

        if ('historyList' in event) {
            const historyList = event.historyList;

            if (!historyList || historyList.options.request !== this.historyRequest) {
                return;
            }

            const incomingCalls = historyList?.results || [];
            const previousCalls = new Map(this.callHistory.map((call) => [call.id, call]));
            const existingCalls = this.historyReplacePending
                ? new Map<number, EmberScannerCall>()
                : new Map(previousCalls);

            incomingCalls.forEach((call) => {
                if (!existingCalls.has(call.id)) {
                    existingCalls.set(call.id, previousCalls.get(call.id) || call);
                }
            });

            this.callHistory = Array.from(existingCalls.values()).sort((a, b) => {
                return new Date(b.dateTime).getTime() - new Date(a.dateTime).getTime();
            });
            this.historyCount = this.historyReplacePending
                ? historyList.count
                : Math.max(historyList.count, this.callHistory.length);
            this.historyLoading = false;
            this.historyReplacePending = false;

            if (typeof this.pendingHistoryIndex === 'number') {
                const pendingIndex = this.pendingHistoryIndex;
                this.pendingHistoryIndex = undefined;

                if (pendingIndex < this.callHistory.length) {
                    this.selectHistoryCall(pendingIndex);
                }
            }
        }

        if ('expired' in event && event.expired === true) {
            this.auth = true;
            this.pinPending = false;
            this.pendingPin = '';
            this.pinError = 'CODE EXPIRED';
            this.emberScannerService.beep(EmberScannerBeepStyle.Denied);
        }

        if ('holdSys' in event) {
            this.holdSys = event.holdSys || false;
        }

        if ('holdTg' in event) {
            this.holdTg = event.holdTg || false;
        }

        if ('linked' in event) {
            this.linked = event.linked || false;
        }

        if ('listeners' in event) {
            this.listeners = event.listeners || 0;
        }

        if ('locked' in event && event.locked === true) {
            const minutes = Math.max(1, Math.ceil((event.retryAfter || 0) / 60));

            this.auth = true;
            this.pinPending = false;
            this.pendingPin = '';
            this.pinError = `TOO MANY ATTEMPTS — TRY AGAIN IN ${minutes} MIN`;
            this.emberScannerService.beep(EmberScannerBeepStyle.Denied);
        }

        if ('map' in event) {
            this.map = event.map || {};

            this.callHistory = this.callHistory.filter((call) => this.isCallEnabled(call));
            this.historyCount = this.callHistory.length;
            this.historyLoading = true;
            this.historyReplacePending = true;
            this.pendingHistoryIndex = undefined;
            this.historyRequest = this.emberScannerService.searchHistoryCalls();
        }

        if ('pause' in event) {
            this.livefeedPaused = event.pause || false;
        }

        if ('queue' in event) {
            this.callQueue = event.queue || 0;
        }

        if ('time' in event && typeof event.time === 'number') {
            this.callTime = event.time;
        }

        if ('tooMany' in event && event.tooMany === true) {
            this.auth = true;
            this.pinPending = false;
            this.pendingPin = '';
            this.pinError = 'TOO MANY CONNECTIONS';
            this.emberScannerService.beep(EmberScannerBeepStyle.Denied);
        }

        if ('livefeedMode' in event && event.livefeedMode) {
            this.livefeedOffline = event.livefeedMode === EmberScannerLivefeedMode.Offline;

            this.livefeedOnline = event.livefeedMode === EmberScannerLivefeedMode.Online;

            this.playbackMode = event.livefeedMode === EmberScannerLivefeedMode.Playback;

            return;
        }

        this.updateDisplay();
    }

    private formatAfs(n: number): string {
        return `${(n >> 7 & 15).toString().padStart(2, '0')}-${(n >> 3 & 15).toString().padStart(2, '0')}${n & 7}`;
    }

    private formatFrequency(frequency: number | undefined): string {
        return typeof frequency === 'number'
            ? `${(frequency / 1_000_000).toFixed(5)} MHz`
            : '';
    }

    talkgroupLabels(call: EmberScannerCall | undefined): string {
        if (!call) {
            return '';
        }

        return this.talkgroupParticipants(call).map(({ ref, label }) => {
            return label || (this.isAfsSystem(call) ? this.formatAfs(ref) : `${ref}`);
        }).join(' ↔ ');
    }

    talkgroupNames(call: EmberScannerCall | undefined): string {
        if (!call) {
            return '';
        }

        const participants = this.talkgroupParticipants(call);
        return participants.map(({ ref, name }) => {
            if (name) {
                return name;
            }
            if (participants.length === 1 && ref === call.talkgroup) {
                return this.formatFrequency(call.frequency);
            }
            return `Talkgroup ${this.isAfsSystem(call) ? this.formatAfs(ref) : ref}`;
        }).join(' / ');
    }

    private talkgroupIds(call: EmberScannerCall): string {
        return this.talkgroupParticipants(call).map(({ ref }) => {
            return this.isAfsSystem(call) ? this.formatAfs(ref) : `${ref}`;
        }).join(' / ');
    }

    private talkgroupParticipants(call: EmberScannerCall): { ref: number; label?: string; name?: string }[] {
        const refs = [...new Set([call.talkgroup, ...(call.patches || [])].filter((ref) => ref > 0))];

        return refs.map((ref) => {
            const talkgroup = ref === call.talkgroup
                ? call.talkgroupData
                : call.patchTalkgroupData?.find((candidate) => candidate.id === ref)
                    || call.systemData?.talkgroups?.find((candidate) => candidate.id === ref);

            return { ref, label: talkgroup?.label, name: talkgroup?.name };
        });
    }

    private getLedColor(call: EmberScannerCall | undefined): string {
        const colors = ['blue', 'cyan', 'green', 'magenta', 'orange', 'red', 'white', 'yellow'];

        let color;

        if (Array.isArray(call?.groupsData)) {
            const group = call?.groupsData.find((g) => g.led);

            if (group?.led) color = group.led;

        } else if (call?.tagData?.led) {
            color = call.tagData?.led

        } else if (call?.systemData?.led) {
            color = call?.systemData.led;

        } else if (call?.talkgroupData?.led) {
            color = call.talkgroupData.led;
        }

        return color && colors.includes(color) ? color : 'green';
    }

    private isAfsSystem(call: EmberScannerCall): boolean {
        return (call.systemData?.type === 'provoice') || (call.talkgroupData?.type === 'provoice');
    }

    private syncClock(): void {
        this.clockTimer?.unsubscribe();

        this.clock = new Date();

        this.clockTimer = timer(1000 * (60 - this.clock.getSeconds())).subscribe(() => this.syncClock());
    }

    private updateDimmer(keepAwake = false): void {
        if (typeof this.config?.dimmerDelay === 'number') {
            this.dimmerTimer?.unsubscribe();
            this.dimmerTimer = undefined;

            this.dimmer = true;

            if (keepAwake) {
                return;
            }

            this.dimmerTimer = timer(this.config.dimmerDelay).subscribe(() => {
                this.dimmerTimer?.unsubscribe();

                this.dimmerTimer = undefined;

                this.dimmer = false;

                this.ngChangeDetectorRef.detectChanges();
            });
        }
    }

    private updateDisplay(time = this.callTime): void {
        const displayCall = this.call || this.callPrevious;
        const displayTime = this.call ? time : 0;

        if (displayCall) {
            this.callProgress = new Date(displayCall.dateTime);
            this.callProgress.setSeconds(this.callProgress.getSeconds() + displayTime);

            if (Date.now() - this.callProgress.getTime() >= 86400000) {
                this.callDate = displayCall.dateTime;
            } else {
                this.callDate = undefined;
            }

            this.callSystem = displayCall.systemData?.label || `${displayCall.system}`;

            this.callGroup = displayCall.talkgroupData?.groups?.join(' / ') || '';

            this.callTag = displayCall.talkgroupData?.tag || '';

            this.callTalkgroup = this.talkgroupLabels(displayCall);

            this.callTalkgroupName = this.talkgroupNames(displayCall);

            this.callTalkgroupId = this.talkgroupIds(displayCall);

            if (Array.isArray(displayCall.frequencies) && displayCall.frequencies.length) {
                const frequency = displayCall.frequencies.reduce((p, v) => (v.pos || 0) <= displayTime ? v : p, {});

                this.callError = typeof frequency.errorCount === 'number' ? `${frequency.errorCount}` : '';

                this.callFrequency = this.formatFrequency(typeof frequency.freq === 'number' ? frequency.freq : displayCall.frequency);

                this.callSpike = typeof frequency.spikeCount === 'number' ? `${frequency.spikeCount}` : '';

            } else {
                this.callError = '';

                this.callFrequency = typeof displayCall.frequency === 'number'
                    ? this.formatFrequency(displayCall.frequency)
                    : '';

                this.callSpike = '';
            }

            if (Array.isArray(displayCall.sources) && displayCall.sources.length) {
                const source = displayCall.sources.reduce((p, v) => (v.pos || 0) <= displayTime ? v : p, {});

                if (typeof source.src === 'number') {
                    if (Array.isArray(displayCall.systemData?.units)) {
                        this.callUnit = displayCall.systemData?.units?.find((u) => {
                            if (typeof u.unitFrom === 'number' && typeof u.unitTo === 'number')
                                if (u.unitFrom <= (source.src as number) && u.unitTo >= (source.src as number))
                                    return true;

                            return u.id === source.src;
                        })?.label ?? `${source.src}`;

                        console.log('here', this.callUnit);

                    } else {
                        this.callUnit = `${source.src}`;
                    }
                }

            } else {
                this.callUnit = displayCall.systemData?.units?.find((u) => u.id === displayCall.source)?.label ?? `${displayCall.source ?? ''}`;
            }

        }

        const call = this.call || this.callPrevious;

        if (call) {
            this.delayed = call.delayed;

            this.tempAvoid = this.emberScannerService.isAvoidedTimer(call);

            if (call.talkgroupData?.type)
                this.type = call.talkgroupData.type;

            else if (call.systemData?.type)
                this.type = call.systemData.type;

            if (this.emberScannerService.isPatched(call)) {
                this.avoided = false;

            } else {
                this.avoided = this.emberScannerService.isAvoided(call);
            }

            this.patched = this.emberScannerService.hasPatches(call);
        }

        this.ledStyle = this.call && this.livefeedPaused ? 'on paused' : this.call ? 'on' : 'off';

        if (this.call) {
            this.ledStyle = `${this.ledStyle} ${this.getLedColor(call)}`;
        }

        this.ngChangeDetectorRef.detectChanges();
    }

    private requestMoreHistory(): void {
        if (this.historyLoading) {
            return;
        }

        this.historyLoading = true;
        this.historyReplacePending = false;
        // Overlap the last row so a call arriving during the request cannot
        // shift offset pagination far enough to leave a gap.
        this.historyRequest = this.emberScannerService.searchHistoryCalls(Math.max(0, this.callHistory.length - 1));
    }

    private isCallEnabled(call: EmberScannerCall): boolean {
        const enabled = (talkgroup: number): boolean => this.map[call.system]?.[talkgroup]?.active === true;

        return enabled(call.talkgroup) || call.patches?.some((talkgroup) => enabled(talkgroup)) === true;
    }

    private upsertHistoryCall(incomingCall: EmberScannerCall): void {
        const historyIndex = this.callHistory.findIndex((call) => call.id === incomingCall.id);

        if (historyIndex >= 0) {
            this.callHistory[historyIndex] = incomingCall;
        } else {
            this.callHistory.unshift(incomingCall);
            this.historyCount = Math.max(this.historyCount + 1, this.callHistory.length);

            const selectedIndex = this.callHistory.findIndex((call) => call.id === this.selectedHistoryCallId);

            if (selectedIndex === 5) {
                this.selectedHistoryCallId = undefined;
            }
        }
    }

    private selectHistoryCall(index: number): void {
        const selectedCall = this.callHistory[index];

        if (!selectedCall) {
            return;
        }

        this.selectedHistoryCallId = selectedCall.id;
        this.emberScannerService.beep(EmberScannerBeepStyle.Activate);
        this.emberScannerService.loadAndPlayHistory(selectedCall.id);
        this.updateDimmer();
    }
}
