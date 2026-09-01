/*
 * *****************************************************************************
 * Copyright (C) 2019-2026 Chrystian Huot <chrystian.huot@saubeo.solutions>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 * *****************************************************************************
 */

import { Component, OnDestroy, ViewChild, ViewEncapsulation } from '@angular/core';
import { AdminEvent, Config, EmberScannerAdminService } from './admin.service';
import { ConfigSection, EmberScannerAdminConfigComponent } from './config/config.component';
import { EmberScannerAdminLogsComponent } from './logs/logs.component';

type AdminSection = 'overview' | 'configuration' | 'logs' | 'tools';

interface AdminNavigationItem {
    id: AdminSection;
    icon: string;
    label: string;
    description: string;
}

@Component({
    encapsulation: ViewEncapsulation.None,
    selector: 'ember-scanner-admin',
    styleUrls: ['./admin.component.scss'],
    templateUrl: './admin.component.html',
    standalone: false
})
export class EmberScannerAdminComponent implements OnDestroy {
    authenticated = true;

    activeSection: AdminSection = 'overview';

    readonly navigation: AdminNavigationItem[] = [
        { id: 'overview', icon: 'space_dashboard', label: 'Overview', description: 'Server health and recommended actions.' },
        { id: 'configuration', icon: 'tune', label: 'Configuration', description: 'Manage scanner behaviour and data sources.' },
        { id: 'logs', icon: 'receipt_long', label: 'Activity logs', description: 'Search and review recent server events.' },
        { id: 'tools', icon: 'construction', label: 'Admin tools', description: 'Import data, export settings and manage security.' },
    ];

    private eventSubscription;

    @ViewChild(EmberScannerAdminLogsComponent) private logsComponent: EmberScannerAdminLogsComponent | undefined;

    constructor(private adminService: EmberScannerAdminService) {
        this.eventSubscription = this.adminService.event.subscribe(async (event: AdminEvent) => {
            if ('authenticated' in event) {
                this.authenticated = event.authenticated || false;
                if (this.authenticated) {
                    this.activeSection = 'overview';
                }
            }
        });
    }

    get activeNavigation(): AdminNavigationItem {
        return this.navigation.find((item) => item.id === this.activeSection) || this.navigation[0];
    }

    ngOnDestroy(): void {
        this.eventSubscription.unsubscribe();
    }

    selectSection(section: AdminSection): void {
        this.activeSection = section;

        if (section === 'logs') {
            this.logsComponent?.reload();
        }
    }

    openConfigSection(section: ConfigSection, configComponent: EmberScannerAdminConfigComponent): void {
        configComponent.selectSection(section);
        this.activeSection = 'configuration';
    }

    applyImportedConfig(config: Config, configComponent: EmberScannerAdminConfigComponent): void {
        configComponent.reset(config, { dirty: true });
        this.activeSection = 'configuration';
    }

    async logout(): Promise<void> {
        await this.adminService.logout();
    }
}
