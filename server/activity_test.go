package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestActivityCountsBoundariesAndPrimaryTalkgroups(t *testing.T) {
	controller := newUnitIngestController(t)
	controller.Options.AutoPopulate = true
	controller.Options.DisableDuplicateDetection = true
	controller.Options.AudioConversion = AUDIO_CONVERSION_DISABLED
	now := time.Date(2026, 9, 3, 12, 7, 0, 0, time.UTC)
	start := now.Add(-24 * time.Hour)
	fixtures := []struct {
		at                time.Time
		system, talkgroup uint
		patches           []uint
	}{
		{start.Add(-time.Millisecond), 1, 101, nil},
		{start, 1, 101, nil},
		{start.Add(23 * time.Minute), 1, 101, nil},
		{now.Add(-2 * time.Minute), 1, 101, []uint{101, 102}},
		{now.Add(-time.Minute), 2, 101, nil},
		{now.Add(-30 * time.Minute), 1, 102, nil},
		{now, 1, 101, nil},
		{now.Add(time.Hour), 1, 101, nil},
	}
	for _, fixture := range fixtures {
		call := NewCall()
		call.Audio = make([]byte, 45)
		call.AudioFilename, call.AudioMime = "activity.wav", "audio/wav"
		call.Meta.SystemRef, call.Meta.TalkgroupRef = fixture.system, fixture.talkgroup
		call.Timestamp, call.Patches = time.Now().Add(-time.Hour), fixture.patches
		call.Units = []CallUnit{{UnitRef: 1}, {UnitRef: 2}}
		controller.IngestCall(call)
		if call.Id == 0 {
			t.Fatal("fixture was not stored")
		}
		// Set archive boundaries directly, avoiding the live delay scheduler for
		// future-dated fixtures in this aggregation test.
		if _, err := controller.Database.Sql.Exec(`UPDATE "calls" SET "timestamp" = ? WHERE "callId" = ?`, fixture.at.UnixMilli(), call.Id); err != nil {
			t.Fatal(err)
		}
	}
	activity, err := readActivity(context.Background(), controller.Database, 24, 0, now)
	if err != nil {
		t.Fatal(err)
	}
	if activity.TotalCalls != 5 || len(activity.Talkgroups) != 3 || len(activity.Systems) != 2 {
		t.Fatalf("totals = %d calls, %d talkgroups, %d systems", activity.TotalCalls, len(activity.Talkgroups), len(activity.Systems))
	}
	if len(activity.Buckets) != 49 || activity.Buckets[0].Start != start.UnixMilli() || activity.Buckets[48].End != now.UnixMilli() {
		t.Fatalf("incorrect rolling window: %+v", activity.Buckets)
	}
	for i, bucket := range activity.Buckets {
		want := int64(0)
		switch i {
		case 0, 1, 47:
			want = 1
		case 48:
			want = 2
		}
		if bucket.Calls != want {
			t.Errorf("bucket %d = %d, want %d", i, bucket.Calls, want)
		}
	}
	leader := activity.Talkgroups[0]
	if leader.Calls != 3 || leader.Reference != 101 || leader.LastCall != now.Add(-2*time.Minute).UnixMilli() {
		t.Fatalf("leader = %+v", leader)
	}
	filtered, err := readActivity(context.Background(), controller.Database, 24, leader.SystemId, now)
	if err != nil {
		t.Fatal(err)
	}
	if filtered.TotalCalls != 4 || len(filtered.Talkgroups) != 2 || len(filtered.Systems) != 2 {
		t.Fatalf("system filter = %+v", filtered)
	}
	var sum int64
	for _, group := range filtered.Talkgroups {
		if group.SystemId != leader.SystemId {
			t.Fatal("system filter leaked another system")
		}
		var buckets int64
		for _, count := range group.Buckets {
			buckets += count
		}
		if buckets != group.Calls {
			t.Fatal("talkgroup total differs from its timeline")
		}
		sum += group.Calls
	}
	if sum != filtered.TotalCalls {
		t.Fatal("rankings do not reconcile with total calls")
	}
}

func TestActivityEmptyRangesAndCancellation(t *testing.T) {
	controller := newUnitIngestController(t)
	for _, hours := range []int{1, 6, 24, 168} {
		activity, err := readActivity(context.Background(), controller.Database, hours, 0, time.Date(2026, 9, 3, 12, 0, 0, 0, time.UTC))
		if err != nil {
			t.Fatal(err)
		}
		if activity.TotalCalls != 0 || activity.Talkgroups == nil || activity.Systems == nil || len(activity.Buckets) == 0 {
			t.Fatalf("invalid empty state: %+v", activity)
		}
		if activity.End-activity.Start != int64(hours)*time.Hour.Milliseconds() {
			t.Fatal("wrong window duration")
		}
		for i, bucket := range activity.Buckets {
			if bucket.Calls != 0 || bucket.End <= bucket.Start {
				t.Fatal("invalid empty bucket")
			}
			if i > 0 && activity.Buckets[i-1].End != bucket.Start {
				t.Fatal("timeline has a gap")
			}
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := readActivity(ctx, controller.Database, 24, 0, time.Now()); err == nil {
		t.Fatal("ignored cancelled query")
	}
}

func TestAdminActivityAuthorizationAndValidation(t *testing.T) {
	admin := newAdminTestController(t).Admin
	token := tokenFromLogin(t, adminLogin(t, admin, "correct-password", "192.0.2.80:1234"))
	for _, test := range []struct {
		method, query, token string
		status               int
	}{
		{http.MethodGet, "", "", http.StatusUnauthorized},
		{http.MethodGet, "", "invalid", http.StatusUnauthorized},
		{http.MethodPost, "", token, http.StatusMethodNotAllowed},
		{http.MethodGet, "?hours=0", token, http.StatusBadRequest},
		{http.MethodGet, "?hours=1000000", token, http.StatusBadRequest},
		{http.MethodGet, "?hours=abc", token, http.StatusBadRequest},
		{http.MethodGet, "?system=-1", token, http.StatusBadRequest},
		{http.MethodGet, "?system=1%20OR%201=1", token, http.StatusBadRequest},
		{http.MethodGet, "", token, http.StatusOK},
		{http.MethodGet, "?hours=168&system=999", token, http.StatusOK},
	} {
		request := httptest.NewRequest(test.method, "/api/admin/activity"+test.query, nil)
		request.Header.Set("Authorization", test.token)
		response := httptest.NewRecorder()
		admin.ActivityHandler(response, request)
		if response.Code != test.status {
			t.Errorf("%s %s = %d, want %d", test.method, test.query, response.Code, test.status)
		}
		if response.Header().Get("Cache-Control") != "no-store" {
			t.Fatal("activity must not be cached")
		}
		if test.status == http.StatusOK {
			var result Activity
			if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
				t.Fatal(err)
			}
			if result.TotalCalls != 0 || result.Talkgroups == nil {
				t.Fatal("invalid empty response")
			}
		}
	}
}

func TestListenerActivityFiltersAccessAndDelaysBeforeCounting(t *testing.T) {
	controller, system, primary := newPersistedPatchTestSystem(t, true)
	db := controller.Database
	now := time.Now()
	for _, query := range []string{
		`INSERT INTO "systems" ("systemId", "systemRef", "label") VALUES (9000, 2, 'Private system')`,
		`INSERT INTO "talkgroups" ("talkgroupId", "systemId", "talkgroupRef", "tagId", "label", "name") VALUES (9001, 9000, 101, 1, 'Private channel', 'Private channel')`,
	} {
		if _, err := db.Sql.Exec(query); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := db.Sql.Exec(`UPDATE "systems" SET "delay" = 30 WHERE "systemId" = ?`, system.Id); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Sql.Exec(`INSERT INTO "talkgroups" ("talkgroupId", "systemId", "talkgroupRef", "tagId", "label", "name", "delay") VALUES (9002, ?, 102, 1, 'Other channel', 'Other channel', 10)`, system.Id); err != nil {
		t.Fatal(err)
	}
	insert := func(sys, tg uint64, ago time.Duration) int64 {
		t.Helper()
		result, err := db.Sql.Exec(`INSERT INTO "calls" ("audio", "audioFilename", "audioMime", "systemId", "talkgroupId", "timestamp") VALUES (?, 'test.wav', 'audio/wav', ?, ?, ?)`, []byte{0}, sys, tg, now.Add(-ago).UnixMilli())
		if err != nil {
			t.Fatal(err)
		}
		id, err := result.LastInsertId()
		if err != nil {
			t.Fatal(err)
		}
		return id
	}
	insert(system.Id, primary.Id, 40*time.Minute)
	insert(system.Id, primary.Id, 5*time.Minute) // system delay applies
	pending := insert(system.Id, primary.Id, 90*time.Minute)
	if _, err := db.Sql.Exec(`INSERT INTO "delayed" ("callId", "timestamp") VALUES (?, ?)`, pending, now.Add(time.Hour).UnixMilli()); err != nil {
		t.Fatal(err)
	}
	insert(system.Id, 9002, 20*time.Minute) // talkgroup delay overrides system delay
	insert(9000, 9001, time.Minute)         // same reference in another system
	access := &Access{Systems: []any{map[string]any{"id": float64(system.SystemRef), "talkgroups": []any{float64(primary.TalkgroupRef)}}}}
	activity, err := readScopedActivity(context.Background(), db, 24, 0, now, access, true)
	if err != nil {
		t.Fatal(err)
	}
	if activity.TotalCalls != 1 || len(activity.Talkgroups) != 1 || len(activity.Systems) != 1 || activity.Systems[0].Id != system.Id {
		t.Fatalf("restricted activity leaked data: %+v", activity)
	}
	denied, err := readScopedActivity(context.Background(), db, 24, 9000, now, access, true)
	if err != nil || denied.TotalCalls != 0 {
		t.Fatalf("system filter bypassed access: %+v, %v", denied, err)
	}
	public, err := readScopedActivity(context.Background(), db, 24, 0, now, nil, true)
	if err != nil || public.TotalCalls != 3 {
		t.Fatalf("public activity delay count: %+v, %v", public, err)
	}
	admin, err := readActivity(context.Background(), db, 24, 0, now)
	if err != nil || admin.TotalCalls != 5 {
		t.Fatalf("admin activity should include held calls: %+v, %v", admin, err)
	}
	empty, err := readScopedActivity(context.Background(), db, 24, 0, now, &Access{}, true)
	if err != nil || empty.TotalCalls != 0 || len(empty.Systems) != 0 {
		t.Fatalf("empty scope did not fail closed: %+v, %v", empty, err)
	}
}

func TestListenerActivityRevalidatesAccessAndBoundsRequests(t *testing.T) {
	controller := newUnitIngestController(t)
	valid := &Access{Code: "1234", Systems: "*"}
	expired := &Access{Code: "5678", Systems: "*", Expiration: uint64(time.Now().Add(-time.Hour).Unix())}
	controller.Accesses.List = []*Access{valid, expired}
	for _, test := range []struct {
		access  *Access
		hours   float64
		command string
	}{
		{NewAccess(), 24, MessageCommandPin},
		{&Access{Code: "revoked", Systems: "*"}, 24, MessageCommandPin},
		{expired, 24, MessageCommandExpired},
		{valid, 24, MessageCommandActivity},
		{valid, 1000000, MessageCommandActivity},
	} {
		client := &Client{Access: test.access, Controller: controller, Send: make(chan *Message, 1)}
		err := controller.ProcessMessage(client, &Message{Command: MessageCommandActivity, Payload: map[string]any{"hours": test.hours, "system": float64(0)}, Flag: "request-7"})
		if err != nil {
			t.Fatal(err)
		}
		select {
		case reply := <-client.Send:
			if reply.Command != test.command {
				t.Fatalf("reply = %#v, want %s", reply, test.command)
			}
			if reply.Command == MessageCommandActivity {
				if reply.Flag != "request-7" {
					t.Fatal("lost request correlation")
				}
				if test.hours == 24 {
					if _, ok := reply.Payload.(*Activity); !ok {
						t.Fatal("valid request failed")
					}
				} else {
					if _, ok := reply.Payload.(map[string]string); !ok {
						t.Fatal("unbounded range was accepted")
					}
				}
			}
		default:
			t.Fatal("request did not produce a response")
		}
	}
}
