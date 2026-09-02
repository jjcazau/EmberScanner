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

import { Component, OnDestroy } from '@angular/core';
import {
    EmberScannerAvoidOptions,
    EmberScannerBeepStyle,
    EmberScannerCategory,
    EmberScannerCategoryStatus,
    EmberScannerEvent,
    EmberScannerLivefeedMap,
    EmberScannerSystem,
    EmberScannerTalkgroup,
} from '../ember-scanner';
import { EmberScannerService } from '../ember-scanner.service';

interface EmberScannerTalkgroupGroup {
    label: string;
    talkgroups: EmberScannerTalkgroup[];
}

@Component({
    selector: 'ember-scanner-select',
    styleUrls: [
        '../common.scss',
        './select.component.scss',
    ],
    templateUrl: './select.component.html',
    standalone: false
})
export class EmberScannerSelectComponent implements OnDestroy {
    categories: EmberScannerCategory[] | undefined;

    map: EmberScannerLivefeedMap = {};

    systems: EmberScannerSystem[] | undefined;

    talkgroupGroups: { [systemId: number]: EmberScannerTalkgroupGroup[] } = {};

    private eventSubscription;

    constructor(private emberScannerService: EmberScannerService) {
        this.eventSubscription = this.emberScannerService.event.subscribe((event: EmberScannerEvent) => this.eventHandler(event));
        this.eventHandler(this.emberScannerService.getSelectionState());
    }

    avoid(options?: EmberScannerAvoidOptions): void {
        if (options?.all == true) {
            this.emberScannerService.beep(EmberScannerBeepStyle.Activate);

        } else if (options?.all == false) {
            this.emberScannerService.beep(EmberScannerBeepStyle.Deactivate);

        } else if (options?.system !== undefined && options?.talkgroup !== undefined) {
            this.emberScannerService.beep(this.map[options.system.id][options.talkgroup.id].active
                ? EmberScannerBeepStyle.Deactivate
                : EmberScannerBeepStyle.Activate
            );

        } else {
            this.emberScannerService.beep(options?.status ? EmberScannerBeepStyle.Activate : EmberScannerBeepStyle.Deactivate);
        }

        this.emberScannerService.avoid(options);
    }

    ngOnDestroy(): void {
        this.eventSubscription.unsubscribe();
    }

    toggle(category: EmberScannerCategory): void {
        if (category.status == EmberScannerCategoryStatus.On)
            this.emberScannerService.beep(EmberScannerBeepStyle.Deactivate);
        else
            this.emberScannerService.beep(EmberScannerBeepStyle.Activate);

        this.emberScannerService.toggleCategory(category);
    }

    private eventHandler(event: EmberScannerEvent): void {
        if (event.config) {
            this.systems = event.config.systems;
            this.talkgroupGroups = this.groupTalkgroups(event.config.systems);
        }
        if (event.categories) this.categories = event.categories;
        if (event.map) this.map = event.map;
    }

    private groupTalkgroups(systems: EmberScannerSystem[]): { [systemId: number]: EmberScannerTalkgroupGroup[] } {
        return systems.reduce((groupedSystems, system) => {
            const groups = new Map<string, EmberScannerTalkgroup[]>();

            system.talkgroups.forEach((talkgroup) => {
                const labels = Array.from(new Set(talkgroup.groups?.filter((label) => label.trim()) || []));

                (labels.length ? labels : ['Ungrouped']).forEach((label) => {
                    const talkgroups = groups.get(label) || [];
                    talkgroups.push(talkgroup);
                    groups.set(label, talkgroups);
                });
            });

            groupedSystems[system.id] = Array.from(groups, ([label, talkgroups]) => ({ label, talkgroups }));

            return groupedSystems;
        }, {} as { [systemId: number]: EmberScannerTalkgroupGroup[] });
    }
}
