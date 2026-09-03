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

import { Component, ElementRef, EventEmitter, HostListener, Input, OnChanges, Output, SimpleChanges, ViewChild } from '@angular/core';
import { EmberScannerBeepStyle } from '../ember-scanner';
import { EmberScannerService } from '../ember-scanner.service';

@Component({
    selector: 'ember-scanner-pin',
    styleUrls: [
        '../common.scss',
        './pin.component.scss',
    ],
    templateUrl: './pin.component.html',
    standalone: false,
})
export class EmberScannerPinComponent implements OnChanges {
    @Input() branding = '';
    @Input() brandingSubheading = '';
    @Input() busy = false;
    @Input() error = '';

    @Output() pinChange = new EventEmitter<void>();
    @Output() pinSubmit = new EventEmitter<string>();

    code = '';
    localError = '';

    readonly digits = [1, 2, 3, 4, 5, 6, 7, 8, 9];

    @ViewChild('codeDisplay') private codeDisplay: ElementRef<HTMLElement> | undefined;

    get message(): string {
        if (this.error) {
            return this.error;
        }

        if (this.localError) {
            return this.localError;
        }

        if (this.busy) {
            return 'CHECKING CODE…';
        }

        return 'ENTER ACCESS CODE';
    }

    constructor(private emberScannerService: EmberScannerService) { }

    append(digit: number): void {
        if (this.busy) {
            return;
        }

        this.clearError();
        this.code += digit.toString();
        this.emberScannerService.beep(EmberScannerBeepStyle.Activate);
        this.scrollCodeToEnd();
    }

    backspace(): void {
        if (this.busy || !this.code.length) {
            this.emberScannerService.beep(EmberScannerBeepStyle.Denied);
            return;
        }

        this.clearError();
        this.code = this.code.slice(0, -1);
        this.emberScannerService.beep(EmberScannerBeepStyle.Deactivate);
    }

    clear(): void {
        if (this.busy) {
            return;
        }

        this.clearError();
        this.code = '';
        this.emberScannerService.beep(EmberScannerBeepStyle.Deactivate);
    }

    enter(): void {
        if (this.busy) {
            return;
        }

        if (!this.code.length) {
            this.localError = 'ENTER A CODE';
            this.emberScannerService.beep(EmberScannerBeepStyle.Denied);
            return;
        }

        this.localError = '';
        this.emberScannerService.beep(EmberScannerBeepStyle.Activate);
        this.pinSubmit.emit(this.code);
    }

    @HostListener('document:keydown', ['$event'])
    handleKeyboard(event: KeyboardEvent): void {
        if (/^[0-9]$/.test(event.key)) {
            event.preventDefault();
            this.append(Number(event.key));
        } else if (event.key === 'Enter') {
            event.preventDefault();
            this.enter();
        } else if (event.key === 'Backspace') {
            event.preventDefault();
            this.backspace();
        } else if (event.key === 'Delete' || event.key === 'Escape') {
            event.preventDefault();
            this.clear();
        }
    }

    ngOnChanges(changes: SimpleChanges): void {
        if (changes['error']?.currentValue) {
            this.code = '';
            this.localError = '';
        }
    }

    private clearError(): void {
        if (this.error || this.localError) {
            this.localError = '';
            this.pinChange.emit();
        }
    }

    private scrollCodeToEnd(): void {
        setTimeout(() => {
            const display = this.codeDisplay?.nativeElement;

            if (display) {
                display.scrollLeft = display.scrollWidth;
            }
        });
    }
}
