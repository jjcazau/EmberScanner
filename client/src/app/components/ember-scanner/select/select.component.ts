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
} from '../ember-scanner';
import { EmberScannerService } from '../ember-scanner.service';

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

    private eventSubscription;

    constructor(private emberScannerService: EmberScannerService) {
        this.eventSubscription = this.emberScannerService.event.subscribe((event: EmberScannerEvent) => this.eventHandler(event));
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
        if (event.config) this.systems = event.config.systems;
        if (event.categories) this.categories = event.categories;
        if (event.map) this.map = event.map;
    }
}
