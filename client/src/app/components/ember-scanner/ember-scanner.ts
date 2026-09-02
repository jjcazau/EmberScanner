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

import { Subscription } from "rxjs";

export interface EmberScannerAvoidOptions {
    all?: boolean;
    call?: EmberScannerCall;
    minutes?: number;
    status?: boolean;
    system?: EmberScannerSystem;
    talkgroup?: EmberScannerTalkgroup;
}

export interface EmberScannerAlerts {
    [key: string]: EmberScannerOscillatorData[];
}

export enum EmberScannerBeepStyle {
    Activate = 'activate',
    Deactivate = 'deactivate',
    Denied = 'denied',
}

export interface EmberScannerCall {
    audio?: {
        type: 'Buffer';
        data: number[];
    };
    audioName?: string;
    audioType?: string;
    dateTime: Date;
    delayed: boolean;
    frequencies?: EmberScannerCallFrequency[];
    frequency?: number;
    groupsData?: EmberScannerGroupData[];
    id: number;
    patches: number[];
    patchTalkgroupData?: EmberScannerTalkgroup[];
    source?: number;
    sources?: EmberScannerCallSource[];
    system: number;
    tagData?: EmberScannerTagData;
    talkgroup: number;
    talkgroupData?: EmberScannerTalkgroup;
    systemData?: EmberScannerSystem;
}

export interface EmberScannerCallFrequency {
    dbm?: number;
    errorCount?: number;
    freq?: number;
    len?: number;
    pos?: number;
    spikeCount?: number;
}

export interface EmberScannerCallSource {
    pos?: number;
    src?: number;
}

export interface EmberScannerCategory {
    label: string;
    status: EmberScannerCategoryStatus;
    type: EmberScannerCategoryType;
}

export enum EmberScannerCategoryStatus {
    Off = 'off',
    On = 'on',
    Partial = 'partial',
}

export enum EmberScannerCategoryType {
    Group = 'group',
    Tag = 'tag',
}

export interface EmberScannerConfig {
    alerts?: EmberScannerAlerts;
    branding?: string;
    dimmerDelay: number | false;
    email?: string;
    groups: { [key: string]: { [key: number]: number[] } };
    groupsData: EmberScannerGroupData[];
    keypadBeeps: EmberScannerKeypadBeeps | undefined;
    playbackGoesLive: boolean;
    showErrorsAndSpikes: boolean;
    showListenersCount: boolean;
    systems: EmberScannerSystem[];
    tags: { [key: string]: { [key: number]: number[] } };
    tagsData: EmberScannerTagData[];
    time12hFormat: boolean;
}

export interface EmberScannerEvent {
    auth?: boolean;
    categories?: EmberScannerCategory[];
    call?: EmberScannerCall;
    config?: EmberScannerConfig;
    expired?: boolean;
    holdSys?: boolean;
    holdTg?: boolean;
    incomingCall?: EmberScannerCall;
    historyList?: EmberScannerPlaybackList;
    linked?: boolean;
    locked?: boolean;
    listeners?: number;
    livefeedMode?: EmberScannerLivefeedMode;
    map?: EmberScannerLivefeedMap;
    pause?: boolean;
    playbackList?: EmberScannerPlaybackList;
    playbackPending?: number;
    queue?: number;
    retryAfter?: number;
    time?: number;
    tooMany?: boolean;
}

export interface EmberScannerGroupData {
    id: number;
    alert?: string;
    label?: string;
    led?: string;
}

export interface EmberScannerKeypadBeeps {
    [EmberScannerBeepStyle.Activate]: EmberScannerOscillatorData[];
    [EmberScannerBeepStyle.Deactivate]: EmberScannerOscillatorData[];
    [EmberScannerBeepStyle.Denied]: EmberScannerOscillatorData[];
}

export interface EmberScannerLivefeed {
    active: boolean;
    minutes: number | undefined;
    timer: Subscription | undefined;
}

export interface EmberScannerLivefeedMap {
    [key: number]: {
        [key: number]: EmberScannerLivefeed;
    };
}

export enum EmberScannerLivefeedMode {
    Offline = 'offline',
    Online = 'online',
    Playback = 'playback',
}

export interface EmberScannerOscillatorData {
    begin: number;
    end: number;
    frequency: number;
    type: OscillatorType;
}

export interface EmberScannerPlaybackList {
    count: number;
    dateStart: Date;
    dateStop: Date;
    options: EmberScannerSearchOptions;
    results: EmberScannerCall[];
}

export interface EmberScannerSearchOptions {
    date?: Date;
    group?: string;
    limit: number;
    livefeed?: boolean;
    offset: number;
    request?: number;
    sort: number;
    system?: number;
    tag?: string;
    talkgroup?: number;
    unit?: number;
}

export interface EmberScannerSystem {
    id: number;
    alert?: string;
    label: string;
    led?: 'blue' | 'cyan' | 'green' | 'magenta' | 'orange' | 'red' | 'white' | 'yellow';
    order?: number;
    talkgroups: EmberScannerTalkgroup[];
    type?: string;
    units: EmberScannerUnit[];
}

export interface EmberScannerTagData {
    id: number;
    alert?: string;
    label?: string;
    led?: string;
}

export interface EmberScannerTalkgroup {
    alert?: string;
    frequency?: number;
    groups: string[];
    id: number;
    label: string;
    led?: 'blue' | 'cyan' | 'green' | 'magenta' | 'orange' | 'red' | 'white' | 'yellow';
    name: string;
    tag: string;
    type?: string;
}

export interface EmberScannerUnit {
    id: number;
    label: string;
    unitRef: number;
    unitFrom: number;
    unitTo: number;
}
