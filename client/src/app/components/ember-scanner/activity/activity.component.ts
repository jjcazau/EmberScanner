import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivityBucket, ActivityTalkgroup, ScannerActivity } from './activity';

@Component({
    selector: 'ember-scanner-activity',
    imports: [CommonModule, FormsModule],
    templateUrl: './activity.component.html',
    styleUrls: ['./activity.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EmberScannerActivityComponent implements OnChanges {
    @Input() data: ScannerActivity | null = null;
    @Input() hours = 24;
    @Input() systemId = 0;
    @Input() loading = false;
    @Input() error = false;
    @Output() readonly rangeChange = new EventEmitter<number>();
    @Output() readonly systemChange = new EventEmitter<number>();
    @Output() readonly refresh = new EventEmitter<void>();

    readonly ranges = [{ hours: 1, label: '1 hour' }, { hours: 6, label: '6 hours' }, { hours: 24, label: '24 hours' }, { hours: 168, label: '7 days' }];
    readonly timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    readonly pageSize = 12;
    search = '';
    relative = false;
    page = 0;
    selectedBucket: number | null = null;
    selectedTalkgroup: number | null = null;
    focusGroup?: ActivityTalkgroup;
    total = 0;
    average = 0;
    activeGroups = 0;
    peak = 0;
    peakIndex = 0;
    maxCell = 0;
    matches = 0;
    selectedCount = 0;
    selectedPeriod = '';
    bucketLabel = '';
    rangeLabel = '';
    bucketColumns = '';
    ticks: { label: string; position: number }[] = [];
    bars: { count: number; height: number; label: string; weight: number }[] = [];
    rows: { group: ActivityTalkgroup; cells: { count: number; level: number; label: string }[] }[] = [];
    leaders: { group: ActivityTalkgroup; count: number; share: number; width: number }[] = [];

    ngOnChanges(changes: SimpleChanges): void {
        if (changes['hours'] || changes['systemId'] || !this.data) {
            this.selectedBucket = null;
            this.selectedTalkgroup = null;
            this.page = 0;
        } else if (changes['data'] && this.selectedBucket !== null) {
            const old = changes['data'].previousValue as ScannerActivity | null;
            const timestamp = old?.buckets[this.selectedBucket]?.start;
            const index = this.data.buckets.findIndex(b => b.start === timestamp);
            this.selectedBucket = index < 0 ? null : index;
        }
        this.rebuild();
    }

    selectBucket(index: number): void {
        this.selectedBucket = this.selectedBucket === index ? null : index;
        this.rebuild();
    }

    selectGroup(id: number): void {
        this.selectedTalkgroup = this.selectedTalkgroup === id ? null : id;
        this.rebuild();
    }

    inspectCell(groupId: number, index: number): void {
        this.selectedTalkgroup = groupId;
        this.selectedBucket = index;
        this.rebuild();
    }

    clearSelection(): void {
        this.selectedBucket = null;
        this.selectedTalkgroup = null;
        this.rebuild();
    }

    filterGroups(): void { this.page = 0; this.rebuild(); }
    movePage(delta: number): void { this.page += delta; this.rebuild(); }

    private period(bucket: ActivityBucket): string {
        const options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false };
        return `${new Date(bucket.start).toLocaleString(undefined, options)} – ${new Date(bucket.end).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })}`;
    }

    rebuild(): void {
        const data = this.data;
        if (!data) return;
        this.focusGroup = data.talkgroups.find(g => g.id === this.selectedTalkgroup);
        if (!this.focusGroup) this.selectedTalkgroup = null;
        const counts = this.focusGroup?.buckets || data.buckets.map(b => b.calls);
        this.total = this.focusGroup?.calls ?? data.totalCalls;
        this.average = this.total / this.hours;
        this.activeGroups = this.focusGroup ? 1 : data.talkgroups.length;
        this.peak = Math.max(0, ...counts);
        this.peakIndex = counts.indexOf(this.peak);
        this.bucketLabel = data.bucketMinutes < 60 ? `${data.bucketMinutes}-minute` : `${data.bucketMinutes / 60}-hour`;
        this.rangeLabel = this.hours === 168 ? 'Last 7 days' : `Last ${this.hours} ${this.hours === 1 ? 'hour' : 'hours'}`;
        this.bucketColumns = data.buckets.map(b => `minmax(0, ${b.end - b.start}fr)`).join(' ');
        this.bars = counts.map((count, i) => ({ count, height: this.peak ? count / this.peak * 100 : 0,
            label: `${this.period(data.buckets[i])}: ${count} ${count === 1 ? 'call' : 'calls'}`, weight: data.buckets[i].end - data.buckets[i].start }));
        this.ticks = [0, .25, .5, .75, 1].map(position => ({
            position: position * 100,
            label: new Date(data.start + (data.end - data.start) * position).toLocaleString(undefined,
                this.hours === 168 ? { weekday: 'short', hour: '2-digit', hour12: false } : { hour: '2-digit', minute: '2-digit', hour12: false }),
        }));
        this.selectedPeriod = this.selectedBucket === null ? 'Entire time range' : this.period(data.buckets[this.selectedBucket]);
        this.selectedCount = this.selectedBucket === null ? data.totalCalls : data.buckets[this.selectedBucket].calls;
        this.maxCell = data.talkgroups.reduce((max, g) => Math.max(max, ...g.buckets), 0);
        const query = this.search.trim().toLocaleLowerCase();
        const groups = data.talkgroups.filter(g => `${g.label} ${g.name} ${g.reference} ${g.systemLabel}`.toLocaleLowerCase().includes(query));
        this.matches = groups.length;
        this.page = Math.min(Math.max(0, this.page), Math.max(0, Math.ceil(groups.length / this.pageSize) - 1));
        this.rows = groups.slice(this.page * this.pageSize, (this.page + 1) * this.pageSize).map(group => {
            const max = this.relative ? Math.max(...group.buckets) : this.maxCell;
            return { group, cells: group.buckets.map((count, i) => ({ count, level: count && max ? Math.ceil(count / max * 4) : 0,
                label: `${group.systemLabel} · ${group.label || group.reference} · ${this.period(data.buckets[i])}: ${count} ${count === 1 ? 'call' : 'calls'}` })) };
        });
        const leaders = data.talkgroups.map(group => ({ group, count: this.selectedBucket === null ? group.calls : group.buckets[this.selectedBucket] }))
            .filter(g => g.count > 0).sort((a, b) => b.count - a.count || a.group.id - b.group.id).slice(0, 5);
        this.leaders = leaders.map(item => ({ ...item, share: this.selectedCount ? item.count / this.selectedCount * 100 : 0, width: item.count / leaders[0].count * 100 }));
    }
}
