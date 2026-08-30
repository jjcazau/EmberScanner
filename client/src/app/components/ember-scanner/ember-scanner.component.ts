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

import { Component, ElementRef, HostListener, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { MatSidenav } from '@angular/material/sidenav';
import { MatSnackBar } from '@angular/material/snack-bar';
import { timer } from 'rxjs';
import { EmberScannerEvent, EmberScannerLivefeedMode } from './ember-scanner';
import { EmberScannerService } from './ember-scanner.service';
import { EmberScannerNativeComponent } from './native/native.component';

@Component({
    selector: 'ember-scanner',
    styleUrls: ['./ember-scanner.component.scss'],
    templateUrl: './ember-scanner.component.html',
    standalone: false
})
export class EmberScannerComponent implements OnDestroy, OnInit {
    private eventSubscription;

    private livefeedMode: EmberScannerLivefeedMode = EmberScannerLivefeedMode.Offline;

    @ViewChild('searchPanel') private searchPanel: MatSidenav | undefined;

    constructor(
        private matSnackBar: MatSnackBar,
        private ngElementRef: ElementRef,
        private emberScannerService: EmberScannerService,
    ) {
        this.eventSubscription = this.emberScannerService.event.subscribe((event: EmberScannerEvent) => this.eventHandler(event));
    }

    @HostListener('window:beforeunload', ['$event'])
    exitNotification(event: BeforeUnloadEvent): void {
        if (this.livefeedMode !== EmberScannerLivefeedMode.Offline) {
            event.preventDefault();

            event.returnValue = 'Live Feed is ON, do you really want to leave?';
        }
    }

    ngOnDestroy(): void {
        this.eventSubscription.unsubscribe();
    }

    ngOnInit(): void {
        /*
         * BEGIN OF RED TAPE:
         * 
         * By modifying, deleting or disabling the following lines, you harm
         * the open source project and its author.  Ember Scanner represents a lot of
         * investment in time, support, testing and hardware.
         * 
         * Be respectful, sponsor the project, use native apps when possible.
         * 
         */
        timer(10000).subscribe(() => {
            const ua: string = navigator.userAgent;

            if (ua.includes('Android') || ua.includes('iPad') || ua.includes('iPhone')) {
                this.matSnackBar.openFromComponent(EmberScannerNativeComponent);
            }
        });
        /**
         * END OF RED TAPE.
         */
    }

    scrollTop(e: HTMLElement): void {
        setTimeout(() => e.scrollTo(0, 0));
    }

    start(): void {
        this.emberScannerService.startLivefeed();
    }

    stop(): void {
        this.emberScannerService.stopLivefeed();

        this.searchPanel?.close();
    }

    toggleFullscreen(): void {
        if (document.fullscreenElement) {
            const el: {
                exitFullscreen?: () => void;
                mozCancelFullScreen?: () => void;
                msExitFullscreen?: () => void;
                webkitExitFullscreen?: () => void;
            } = document;

            if (el.exitFullscreen) {
                el.exitFullscreen();

            } else if (el.mozCancelFullScreen) {
                el.mozCancelFullScreen();

            } else if (el.msExitFullscreen) {
                el.msExitFullscreen();

            } else if (el.webkitExitFullscreen) {
                el.webkitExitFullscreen();
            }

        } else {
            const el = this.ngElementRef.nativeElement;

            if (el.requestFullscreen) {
                el.requestFullscreen();

            } else if (el.mozRequestFullScreen) {
                el.mozRequestFullScreen();

            } else if (el.msRequestFullscreen) {
                el.msRequestFullscreen();

            } else if (el.webkitRequestFullscreen) {
                el.webkitRequestFullscreen();
            }
        }
    }

    private eventHandler(event: EmberScannerEvent): void {
        if (event.livefeedMode) {
            this.livefeedMode = event.livefeedMode;
        }
    }
}
