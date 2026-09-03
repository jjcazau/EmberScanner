export interface ActivityBucket {
    start: number;
    end: number;
    calls: number;
}

export interface ActivityTalkgroup {
    id: number;
    systemId: number;
    systemLabel: string;
    reference: number;
    label: string;
    name: string;
    calls: number;
    lastCall: number;
    buckets: number[];
}

export interface ScannerActivity {
    start: number;
    end: number;
    bucketMinutes: number;
    totalCalls: number;
    systems: { id: number; label: string }[];
    buckets: ActivityBucket[];
    talkgroups: ActivityTalkgroup[];
}
