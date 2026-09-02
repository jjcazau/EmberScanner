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

import { AfterViewInit, ChangeDetectorRef, Component, ElementRef, OnDestroy, ViewChild } from '@angular/core';
import { FormBuilder, FormGroup } from '@angular/forms';
import { BehaviorSubject } from 'rxjs';
import {
    EmberScannerCall,
    EmberScannerConfig,
    EmberScannerEvent,
    EmberScannerLivefeedMode,
    EmberScannerPlaybackList,
    EmberScannerSearchOptions,
    EmberScannerSystem,
    EmberScannerTalkgroup,
} from '../ember-scanner';
import { EmberScannerService } from '../ember-scanner.service';

@Component({
    selector: 'ember-scanner-search',
    styleUrls: ['./search.component.scss'],
    templateUrl: './search.component.html',
    standalone: false
})
export class EmberScannerSearchComponent implements AfterViewInit, OnDestroy {
    call: EmberScannerCall | undefined;
    callPending: number | undefined;

    form: FormGroup;

    filtersExpanded = false;

    livefeedOnline = false;
    livefeedPlayback = false;

    playbackList: EmberScannerPlaybackList | undefined;

    optionsGroup: string[] = [];
    optionsSystem: string[] = [];
    optionsTag: string[] = [];
    optionsTalkgroup: string[] = [];

    paused = false;

    hasMoreResults = true;

    results = new BehaviorSubject<EmberScannerCall[]>([]);
    resultsPending = false;

    time12h = false;

    get activeFilterCount(): number {
        const value = this.form.getRawValue();

        return [value.date, value.group, value.system, value.tag, value.talkgroup, value.unit]
            .filter((filter, index) => index === 0 ? !!filter : typeof filter === 'number' && filter >= 0)
            .length;
    }

    private config: EmberScannerConfig | undefined;

    private eventSubscription;

    private intersectionObserver: IntersectionObserver | undefined;

    private limit = 30;

    private offset = 0;

    private selectableSystems: EmberScannerSystem[] = [];

    private selectableTalkgroups: EmberScannerTalkgroup[] = [];

    @ViewChild('loadMoreTrigger', { read: ElementRef }) private loadMoreTrigger: ElementRef<HTMLElement> | undefined;

    constructor(
        private emberScannerService: EmberScannerService,
        private ngChangeDetectorRef: ChangeDetectorRef,
        private ngFormBuilder: FormBuilder,
    ) {
        this.form = this.ngFormBuilder.group<{
            date: string | null;
            group: number;
            sort: number;
            system: number;
            tag: number;
            talkgroup: number;
            unit: number;
        }>({
            date: null,
            group: -1,
            sort: -1,
            system: -1,
            tag: -1,
            talkgroup: -1,
            unit: -1,
        });

        this.eventSubscription = this.emberScannerService.event.subscribe((event: EmberScannerEvent) => this.eventHandler(event));
    }

    activateRow(row: EmberScannerCall | undefined, downloadMode: boolean): void {
        if (!row?.id) {
            return;
        }

        if (downloadMode) {
            this.download(+row.id);
        } else if (row.id === this.call?.id) {
            this.stop();
        } else if (!this.paused && row.id !== this.callPending) {
            this.play(+row.id);
        }
    }

    download(id: number): void {
        this.emberScannerService.loadAndDownload(id);
    }

    formChangeHandler(): void {
        if (this.livefeedPlayback) {
            this.emberScannerService.stopPlaybackMode();
        }

        this.refreshFilters();

        this.searchCalls();
    }

    loadMoreResults(): void {
        if (!this.resultsPending && this.hasMoreResults && !this.livefeedPlayback) {
            this.searchCalls(this.results.value.length > 0);
        }
    }

    hasPatches(call: EmberScannerCall | undefined): boolean {
        return !!call && this.emberScannerService.hasPatches(call);
    }

    talkgroupIds(call: EmberScannerCall | undefined): string {
        if (!call) {
            return '';
        }

        return this.talkgroupParticipants(call).map(({ ref }) => this.formatTalkgroupRef(call, ref)).join(' / ');
    }

    talkgroupLabels(call: EmberScannerCall | undefined): string {
        if (!call) {
            return '';
        }

        return this.talkgroupParticipants(call)
            .map(({ ref, talkgroup }) => talkgroup?.label || this.formatTalkgroupRef(call, ref))
            .join(' ↔ ');
    }

    talkgroupNames(call: EmberScannerCall | undefined): string {
        if (!call) {
            return '';
        }

        return this.talkgroupParticipants(call)
            .map(({ ref, talkgroup }) => talkgroup?.name || `Talkgroup ${this.formatTalkgroupRef(call, ref)}`)
            .join(' / ');
    }

    ngAfterViewInit(): void {
        if (typeof IntersectionObserver === 'undefined' || !this.loadMoreTrigger) {
            return;
        }

        this.intersectionObserver = new IntersectionObserver((entries) => {
            if (entries.some((entry) => entry.isIntersecting)) {
                this.loadMoreResults();
            }
        }, {
            rootMargin: '240px 0px',
            threshold: 0,
        });

        this.observeLoadMoreTrigger();
    }

    ngOnDestroy(): void {
        this.intersectionObserver?.disconnect();

        this.eventSubscription.unsubscribe();
    }

    play(id: number): void {
        this.emberScannerService.loadAndPlay(id);
    }

    refreshFilters(): void {
        if (!this.config) {
            return;
        }

        const selectedGroup = this.getSelectedGroup();
        const selectedSystem = this.getSelectedSystem();
        const selectedTag = this.getSelectedTag();
        const selectedTalkgroup = this.getSelectedTalkgroup();

        this.selectableSystems = this.config.systems
            .filter((system) => {
                const group = selectedGroup === undefined ||
                    system.talkgroups.some((talkgroup) => talkgroup.groups.includes(selectedGroup));
                const tag = selectedTag === undefined ||
                    system.talkgroups.some((talkgroup) => talkgroup.tag === selectedTag);
                return group && tag;
            });
        this.optionsSystem = this.selectableSystems.map((system) => system.label);

        this.selectableTalkgroups = selectedSystem == undefined
            ? []
            : selectedSystem.talkgroups
                .filter((talkgroup) => {
                    const group = selectedGroup == undefined ||
                        talkgroup.groups.includes(selectedGroup);
                    const tag = selectedTag == undefined ||
                        talkgroup.tag === selectedTag;
                    return group && tag;
                });
        this.optionsTalkgroup = this.selectableTalkgroups.map((talkgroup) => talkgroup.label);

        this.optionsGroup = Object.keys(this.config.groups)
            .filter((group) => {
                const system: boolean = selectedSystem === undefined ||
                    selectedSystem.talkgroups.some((talkgroup) => talkgroup.groups.includes(group))
                const talkgroup: boolean = selectedTalkgroup === undefined ||
                    selectedTalkgroup.groups.includes(group);
                const tag: boolean = selectedTag === undefined ||
                    (selectedTalkgroup !== undefined && selectedTalkgroup.tag === selectedTag) ||
                    (this.config !== undefined && this.config.systems
                        .flatMap((system) => system.talkgroups)
                        .some((talkgroup) => talkgroup.groups.includes(group) && talkgroup.tag === selectedTag))
                return system && talkgroup && tag;
            })
            .sort((a, b) => a.localeCompare(b))

        this.optionsTag = Object.keys(this.config.tags)
            .filter((tag) => {
                const system: boolean = selectedSystem === undefined ||
                    selectedSystem.talkgroups.some((talkgroup) => talkgroup.tag === tag)
                const talkgroup: boolean = selectedTalkgroup === undefined ||
                    selectedTalkgroup.tag === tag;
                const group: boolean = selectedGroup === undefined ||
                    (selectedTalkgroup !== undefined && selectedTalkgroup.groups.includes(selectedGroup)) ||
                    (this.config !== undefined && this.config.systems
                        .flatMap((system) => system.talkgroups)
                        .some((talkgroup) => talkgroup.tag === tag && talkgroup.groups.includes(selectedGroup)))
                return system && talkgroup && group;
            })
            .sort((a, b) => a.localeCompare(b))

        this.form.patchValue({
            group: selectedGroup ? this.optionsGroup.findIndex((group) => group === selectedGroup) : -1,
            system: selectedSystem ? this.selectableSystems.findIndex((system) => system.id === selectedSystem.id) : -1,
            tag: selectedTag ? this.optionsTag.findIndex((tag) => tag === selectedTag) : -1,
            talkgroup: selectedTalkgroup ? this.selectableTalkgroups.findIndex((talkgroup) => talkgroup.id === selectedTalkgroup.id) : -1,
        });
    }

    resetForm(): void {
        this.form.reset({
            date: null,
            group: -1,
            sort: -1,
            system: -1,
            tag: -1,
            talkgroup: -1,
            unit: -1,
        });

        this.formChangeHandler();

        this.filtersExpanded = false;
    }

    toggleFilters(): void {
        this.filtersExpanded = !this.filtersExpanded;
    }

    searchCalls(append = false): void {
        if (this.livefeedPlayback || this.resultsPending || (append && !this.hasMoreResults)) {
            return;
        }

        if (!append) {
            this.offset = 0;
            this.hasMoreResults = true;
            this.playbackList = undefined;
            this.results.next([]);
        }

        const options: EmberScannerSearchOptions = {
            limit: this.limit,
            offset: this.offset,
            sort: this.form.get('sort')?.value ?? -1,
        };

        if (typeof this.form.value.date === 'string') {
            options.date = new Date(Date.parse(this.form.value.date));
        }

        if ((this.form.get('group')?.value ?? -1) >= 0) {
            const group = this.getSelectedGroup();

            if (group) {
                options.group = group;
            }
        }

        if ((this.form.get('system')?.value ?? -1) >= 0) {
            const system = this.getSelectedSystem();

            if (system) {
                options.system = system.id;
            }
        }

        if ((this.form.get('tag')?.value ?? -1) >= 0) {
            const tag = this.getSelectedTag();

            if (tag) {
                options.tag = tag;
            }
        }

        if ((this.form.get('talkgroup')?.value ?? -1) >= 0) {
            const talkgroup = this.getSelectedTalkgroup();

            if (talkgroup) {
                options.talkgroup = talkgroup.id;
            }
        }

        if ((this.form.get('unit')?.value ?? -1) >= 0) {
            options.unit = this.form.get('unit')?.value;
        }

        this.resultsPending = true;

        this.form.disable();

        this.emberScannerService.searchCalls(options, { append });
    }

    stop(): void {
        if (this.livefeedPlayback) {
            this.emberScannerService.stopPlaybackMode();

        } else {
            this.emberScannerService.stop();
        }
    }

    private eventHandler(event: EmberScannerEvent): void {
        if ('call' in event) {
            this.call = event.call;

            if (this.callPending) {
                this.callPending = undefined;
            }
        }

        if ('config' in event) {
            this.config = event.config;

            this.callPending = undefined;

            this.optionsGroup = Object.keys(this.config?.groups || []).sort((a, b) => a.localeCompare(b));
            this.selectableSystems = this.config?.systems || [];
            this.optionsSystem = this.selectableSystems.map((system) => system.label);
            this.selectableTalkgroups = [];
            this.optionsTalkgroup = [];
            this.optionsTag = Object.keys(this.config?.tags || []).sort((a, b) => a.localeCompare(b));

            this.time12h = this.config?.time12hFormat || false;
        }

        if ('livefeedMode' in event) {
            this.livefeedOnline = event.livefeedMode === EmberScannerLivefeedMode.Online;

            this.livefeedPlayback = event.livefeedMode === EmberScannerLivefeedMode.Playback;
        }

        if ('playbackList' in event) {
            this.playbackList = event.playbackList;

            const loadedResults = this.playbackList?.results || [];

            this.results.next(loadedResults);
            this.offset = loadedResults.length;
            this.hasMoreResults = loadedResults.length < (this.playbackList?.count || 0);

            this.resultsPending = false;

            this.form.enable();

            setTimeout(() => this.observeLoadMoreTrigger());
        }

        if ('playbackPending' in event) {
            this.callPending = event.playbackPending;
        }

        if ('pause' in event) {
            this.paused = event.pause || false;
        }

        this.ngChangeDetectorRef.detectChanges();
    }

    private getSelectedGroup(): string | undefined {
        return this.optionsGroup[this.form.get('group')?.value ?? -1];
    }

    private formatTalkgroupRef(call: EmberScannerCall, ref: number): string {
        if (call.systemData?.type === 'provoice' || call.talkgroupData?.type === 'provoice') {
            return `${(ref >> 7 & 15).toString().padStart(2, '0')}-${(ref >> 3 & 15).toString().padStart(2, '0')}${ref & 7}`;
        }

        return `${ref}`;
    }

    private talkgroupParticipants(call: EmberScannerCall): { ref: number; talkgroup?: EmberScannerTalkgroup }[] {
        const refs = [...new Set([call.talkgroup, ...(call.patches || [])].filter((ref) => ref > 0))];

        return refs.map((ref) => ({
            ref,
            talkgroup: ref === call.talkgroup
                ? call.talkgroupData
                : call.patchTalkgroupData?.find((candidate) => candidate.id === ref)
                    || call.systemData?.talkgroups.find((candidate) => candidate.id === ref),
        }));
    }

    private getSelectedSystem(): EmberScannerSystem | undefined {
        return this.selectableSystems[this.form.get('system')?.value ?? -1];
    }

    private getSelectedTag(): string | undefined {
        return this.optionsTag[this.form.get('tag')?.value ?? -1];
    }

    private getSelectedTalkgroup(): EmberScannerTalkgroup | undefined {
        return this.getSelectedSystem()
            ? this.selectableTalkgroups[this.form.get('talkgroup')?.value ?? -1]
            : undefined;
    }

    private observeLoadMoreTrigger(): void {
        if (this.intersectionObserver && this.loadMoreTrigger) {
            this.intersectionObserver.unobserve(this.loadMoreTrigger.nativeElement);
            this.intersectionObserver.observe(this.loadMoreTrigger.nativeElement);
        }
    }
}
