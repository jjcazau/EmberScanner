import { CommonModule } from '@angular/common';
import { Component, EventEmitter, OnDestroy, OnInit, Output, SimpleChange } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BehaviorSubject, catchError, exhaustMap, filter, finalize, merge, of, Subject, Subscription, switchMap, timer } from 'rxjs';
import { EmberScannerService } from '../ember-scanner.service';
import { EmberScannerActivityComponent } from './activity.component';

// Reuse the chart calculations and interactions with a scanner-specific view.
@Component({
    selector: 'ember-scanner-activity-screen',
    imports: [CommonModule, FormsModule],
    templateUrl: './activity-screen.component.html',
    styleUrls: ['./activity-screen.component.scss'],
})
export class EmberScannerActivityScreenComponent extends EmberScannerActivityComponent implements OnInit, OnDestroy {
    @Output() readonly close = new EventEmitter<void>();
    readonly refreshRequests = new Subject<void>();
    private readonly query = new BehaviorSubject({ hours: 24, systemId: 0 });
    private readonly subscriptions = new Subscription();

    constructor(private scanner: EmberScannerService) { super(); }

    ngOnInit(): void {
        this.subscriptions.add(this.query.pipe(switchMap(query => {
            this.data = null;
            this.error = false;
            this.clearSelection();
            this.page = 0;
            return merge(timer(0, 30_000).pipe(filter(tick => tick === 0 || !document.hidden)), this.refreshRequests).pipe(
                exhaustMap(() => {
                    this.loading = true;
                    return this.scanner.getActivity(query.hours, query.systemId).pipe(
                        catchError(() => { this.error = true; return of(null); }),
                        finalize(() => this.loading = false),
                    );
                }),
            );
        })).subscribe(data => {
            if (!data) return;
            const previous = this.data;
            this.data = data;
            this.error = false;
            super.ngOnChanges({ data: new SimpleChange(previous, data, !previous) });
        }));
        this.subscriptions.add(this.scanner.event.subscribe(event => {
            if (event.auth) { this.data = null; this.close.emit(); }
            else if (event.config) this.query.next({ hours: this.hours, systemId: this.systemId });
        }));
    }

    setRange(hours: number): void { this.hours = hours; this.query.next({ hours, systemId: this.systemId }); }
    setSystem(systemId: number): void { this.systemId = systemId; this.query.next({ hours: this.hours, systemId }); }

    override rebuild(): void {
        super.rebuild();
        if (!this.data) return;
        const step = (this.hours === 1 ? 10 : this.hours === 6 ? 30 : this.hours === 24 ? 120 : 720) * 60_000;
        const { start, end } = this.data;
        const markers: number[] = [];
        for (let time = Math.ceil(start / step) * step; time < end; time += step) markers.push(time);
        this.ticks = markers.map(time => ({ position: (time - start) / (end - start) * 100,
            label: new Date(time).toLocaleString(undefined, this.hours === 168
                ? { weekday: 'short', hour: '2-digit', hour12: false }
                : { hour: '2-digit', minute: '2-digit', hour12: false }) }));
    }

    ngOnDestroy(): void { this.subscriptions.unsubscribe(); this.query.complete(); this.refreshRequests.complete(); }
}
