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

import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { NgModule } from '@angular/core';
import { AppSharedModule } from '../../../shared/shared.module';
import { EmberScannerAdminComponent } from './admin.component';
import { EmberScannerAdminService } from './admin.service';
import { EmberScannerAdminConfigComponent } from './config/config.component';
import { EmberScannerAdminAccessComponent } from './config/access/access.component';
import { EmberScannerAdminApikeysComponent } from './config/apikeys/apikeys.component';
import { EmberScannerAdminDirwatchComponent } from './config/dirwatch/dirwatch.component';
import { EmberScannerAdminDownstreamsComponent } from './config/downstreams/downstreams.component';
import { EmberScannerAdminGroupsComponent } from './config/groups/groups.component';
import { EmberScannerAdminOptionsComponent } from './config/options/options.component';
import { EmberScannerAdminSiteComponent } from './config/systems/site/site.component';
import { EmberScannerAdminSystemsSelectComponent } from './config/systems/select/select.component';
import { EmberScannerAdminSystemComponent } from './config/systems/system/system.component';
import { EmberScannerAdminSystemsComponent } from './config/systems/systems.component';
import { EmberScannerAdminTalkgroupComponent } from './config/systems/talkgroup/talkgroup.component';
import { EmberScannerAdminUnitComponent } from './config/systems/unit/unit.component';
import { EmberScannerAdminTagsComponent } from './config/tags/tags.component';
import { EmberScannerAdminLoginComponent } from './login/login.component';
import { EmberScannerAdminLogsComponent } from './logs/logs.component';
import { EmberScannerAdminTodosComponent } from './todos/todos.component';
import { EmberScannerAdminToolsComponent } from './tools/tools.component';
import { EmberScannerAdminImportExportConfigComponent } from './tools/import-export-config/import-export-config.component';
import { EmberScannerAdminImportTalkgroupsComponent } from './tools/import-talkgroups/import-talkgroups.component';
import { EmberScannerAdminImportUnitsComponent } from './tools/import-units/import-units.component';
import { EmberScannerAdminPasswordComponent } from './tools/password/password.component';

@NgModule({ declarations: [
        EmberScannerAdminComponent,
        EmberScannerAdminConfigComponent,
        EmberScannerAdminAccessComponent,
        EmberScannerAdminApikeysComponent,
        EmberScannerAdminDirwatchComponent,
        EmberScannerAdminDownstreamsComponent,
        EmberScannerAdminGroupsComponent,
        EmberScannerAdminImportExportConfigComponent,
        EmberScannerAdminImportTalkgroupsComponent,
        EmberScannerAdminImportUnitsComponent,
        EmberScannerAdminLoginComponent,
        EmberScannerAdminLogsComponent,
        EmberScannerAdminOptionsComponent,
        EmberScannerAdminPasswordComponent,
        EmberScannerAdminSiteComponent,
        EmberScannerAdminSystemComponent,
        EmberScannerAdminSystemsComponent,
        EmberScannerAdminSystemsSelectComponent,
        EmberScannerAdminTagsComponent,
        EmberScannerAdminTalkgroupComponent,
        EmberScannerAdminTodosComponent,
        EmberScannerAdminToolsComponent,
        EmberScannerAdminUnitComponent,
    ],
    exports: [EmberScannerAdminComponent], imports: [AppSharedModule], providers: [EmberScannerAdminService, provideHttpClient(withInterceptorsFromDi())] })
export class EmberScannerAdminModule { }
