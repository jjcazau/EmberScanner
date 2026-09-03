import { Component, OnDestroy, OnInit } from '@angular/core';
import { BehaviorSubject, catchError, exhaustMap, finalize, merge, of, Subject, Subscription, switchMap, timer, filter } from 'rxjs';
import { EmberScannerActivityComponent } from '../../activity/activity.component';
import { ScannerActivity } from '../../activity/activity';
import { EmberScannerAdminService } from '../admin.service';

@Component({
    selector: 'ember-scanner-admin-activity',
    imports: [EmberScannerActivityComponent],
    template: `<ember-scanner-activity [data]="data" [hours]="hours" [systemId]="systemId"
        [loading]="loading" [error]="error" (rangeChange)="setRange($event)"
        (systemChange)="setSystem($event)" (refresh)="refresh.next()" />`,
})
export class EmberScannerAdminActivityComponent implements OnInit, OnDestroy {
    data: ScannerActivity | null = null;
    hours = 24;
    systemId = 0;
    loading = true;
    error = false;
    readonly refresh = new Subject<void>();
    private readonly query = new BehaviorSubject({ hours: 24, systemId: 0 });
    private subscription?: Subscription;

    constructor(private admin: EmberScannerAdminService) {}

    ngOnInit(): void {
        this.subscription = this.query.pipe(switchMap(query => {
            this.data = null;
            this.error = false;
            return merge(timer(0, 30_000).pipe(filter(tick => tick === 0 || !document.hidden)), this.refresh).pipe(
                exhaustMap(() => {
                    this.loading = true;
                    return this.admin.getActivity(query.hours, query.systemId).pipe(
                        catchError(() => { this.error = true; return of(null); }),
                        finalize(() => this.loading = false),
                    );
                }),
            );
        })).subscribe(data => {
            if (data) { this.data = data; this.error = false; }
        });
    }

    setRange(hours: number): void {
        this.hours = hours;
        this.query.next({ hours, systemId: this.systemId });
    }

    setSystem(systemId: number): void {
        this.systemId = systemId;
        this.query.next({ hours: this.hours, systemId });
    }

    ngOnDestroy(): void {
        this.subscription?.unsubscribe();
        this.refresh.complete();
        this.query.complete();
    }
}
