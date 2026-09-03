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

import { FullscreenOverlayContainer, OverlayContainer } from '@angular/cdk/overlay';
import { NgModule } from '@angular/core';
import { AppSharedModule } from '../../shared/shared.module';
import { EmberScannerComponent } from './ember-scanner.component';
import { EmberScannerService } from './ember-scanner.service';
import { EmberScannerMainComponent } from './main/main.component';
import { EmberScannerSupportComponent } from './main/support/support.component';
import { EmberScannerNativeModule } from './native/native.module';
import { EmberScannerPinComponent } from './pin/pin.component';
import { EmberScannerSearchComponent } from './search/search.component';
import { EmberScannerSelectComponent } from './select/select.component';
import { EmberScannerActivityScreenComponent } from './activity/activity-screen.component';

@NgModule({
    declarations: [
        EmberScannerComponent,
        EmberScannerMainComponent,
        EmberScannerPinComponent,
        EmberScannerSearchComponent,
        EmberScannerSelectComponent,
        EmberScannerSupportComponent,
    ],
    exports: [EmberScannerComponent],
    imports: [
        AppSharedModule,
        EmberScannerNativeModule,
        EmberScannerActivityScreenComponent,
    ],
    providers: [
        EmberScannerService,
        { provide: OverlayContainer, useClass: FullscreenOverlayContainer },
    ],
})
export class EmberScannerModule { }
