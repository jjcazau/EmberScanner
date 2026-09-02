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

import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit, ViewEncapsulation } from '@angular/core';
import { FormArray, FormControl, FormGroup } from '@angular/forms';
import { AdminEvent, EmberScannerAdminService, Config } from '../admin.service';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

export type ConfigSection = 'access' | 'apikeys' | 'dirwatch' | 'downstreams' | 'groups' | 'options' | 'systems' | 'tags';

interface ConfigNavigationItem {
    id: ConfigSection;
    control: string;
    icon: string;
    label: string;
    description: string;
    hideInDocker?: boolean;
}

@Component({
    changeDetection: ChangeDetectionStrategy.OnPush,
    encapsulation: ViewEncapsulation.None,
    selector: 'ember-scanner-admin-config',
    styleUrls: ['./config.component.scss'],
    templateUrl: './config.component.html',
    standalone: false
})
export class EmberScannerAdminConfigComponent implements OnDestroy, OnInit {
    docker = false;

    form: FormGroup | undefined;

    activeSection: ConfigSection = 'options';

    readonly sections: ConfigNavigationItem[] = [
        { id: 'options', control: 'options', icon: 'tune', label: 'General', description: 'Core playback, display and server behaviour.' },
        { id: 'systems', control: 'systems', icon: 'podcasts', label: 'Systems', description: 'Radio systems, sites, talkgroups and units.' },
        { id: 'groups', control: 'groups', icon: 'workspaces', label: 'Groups', description: 'Organise talkgroups into reusable collections.' },
        { id: 'tags', control: 'tags', icon: 'sell', label: 'Tags', description: 'Categorise talkgroups for search and display.' },
        { id: 'access', control: 'access', icon: 'manage_accounts', label: 'Access', description: 'Control who can listen to this scanner.' },
        { id: 'apikeys', control: 'apikeys', icon: 'vpn_key', label: 'API keys', description: 'Credentials for uploaders and downstream servers.' },
        { id: 'dirwatch', control: 'dirwatch', icon: 'folder', label: 'Directory watch', description: 'Monitor local directories for new audio.', hideInDocker: true },
        { id: 'downstreams', control: 'downstreams', icon: 'share', label: 'Downstreams', description: 'Forward calls to other Ember Scanner instances.' },
    ];

    get access(): FormArray {
        return this.form?.get('access') as FormArray;
    }

    get apikeys(): FormArray {
        return this.form?.get('apikeys') as FormArray;
    }

    get dirwatch(): FormArray {
        return this.form?.get('dirwatch') as FormArray;
    }

    get downstreams(): FormArray {
        return this.form?.get('downstreams') as FormArray;
    }

    get groups(): FormArray {
        return this.form?.get('groups') as FormArray;
    }

    get options(): FormGroup {
        return this.form?.get('options') as FormGroup;
    }

    get systems(): FormArray {
        return this.form?.get('systems') as FormArray;
    }

    get tags(): FormArray {
        return this.form?.get('tags') as FormArray;
    }

    private config: Config | undefined;

    private readonly destroy$ = new Subject<void>();

    constructor(
        private adminService: EmberScannerAdminService,
        private ngChangeDetectorRef: ChangeDetectorRef,
    ) {
        this.adminService.event.pipe(takeUntil(this.destroy$)).subscribe(async (event: AdminEvent) => {
            if ('authenticated' in event && event.authenticated === true) {
                this.config = await this.adminService.getConfig();
                this.reset();
            }

            if ('config' in event) {
                this.config = event.config;

                if (this.form?.pristine) {
                    this.reset();
                }
            }

            if ('docker' in event) {
                this.docker = event.docker ?? false;
            }
        });
    }

    ngOnDestroy(): void {
        this.destroy$.next();
        this.destroy$.complete();
    }

    async ngOnInit(): Promise<void> {
        await this.adminService.loadAlerts();

        this.config = await this.adminService.getConfig();

        this.reset();
    }

    get activeNavigation(): ConfigNavigationItem {
        return this.sections.find((item) => item.id === this.activeSection) || this.sections[0];
    }

    selectSection(section: ConfigSection): void {
        this.activeSection = section;
    }

    reset(config = this.config, options?: { dirty?: boolean }): void {
        this.form = this.adminService.newConfigForm(config);

        this.form.statusChanges.pipe(takeUntil(this.destroy$)).subscribe(() => {
            this.ngChangeDetectorRef.markForCheck();
        });

        const systemsArray = this.systems;
        const groupsArray = this.groups;
        const tagsArray = this.tags;

        groupsArray?.valueChanges.pipe(takeUntil(this.destroy$)).subscribe(() => {
            if (!systemsArray) { return; }
            systemsArray.controls.forEach((system) => {
                const talkgroups = system.get('talkgroups') as FormArray;

                talkgroups.controls.forEach((talkgroup) => {
                    const groupIds = talkgroup.get('groupIds') as FormArray;

                    groupIds.updateValueAndValidity({ onlySelf: true });

                    if (groupIds.errors) {
                        groupIds.markAsTouched({ onlySelf: true });
                    }
                });
            });
        });

        tagsArray?.valueChanges.pipe(takeUntil(this.destroy$)).subscribe(() => {
            if (!systemsArray) { return; }
            systemsArray.controls.forEach((system) => {
                const talkgroups = system.get('talkgroups') as FormArray;

                talkgroups.controls.forEach((talkgroup) => {
                    const tagId = talkgroup.get('tagId') as FormControl;

                    tagId.updateValueAndValidity({ onlySelf: true });

                    if (tagId.errors) {
                        tagId.markAsTouched({ onlySelf: true });
                    }
                });
            });
        });

        if (options?.dirty === true) {
            this.form.markAsDirty();
        }

        this.ngChangeDetectorRef.markForCheck();
    }

    async save(): Promise<void> {
        if (!this.form) { return; }

        try {
            this.config = await this.adminService.saveConfig(this.form.getRawValue());

            this.form.markAsPristine();
        } catch {
            this.form.markAsDirty();
        }
    }
}
