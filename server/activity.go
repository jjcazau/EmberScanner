package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"
)

type ActivitySystem struct {
	Id    uint64 `json:"id"`
	Label string `json:"label"`
}

type ActivityBucket struct {
	Start int64 `json:"start"`
	End   int64 `json:"end"`
	Calls int64 `json:"calls"`
}

type ActivityTalkgroup struct {
	Id          uint64  `json:"id"`
	SystemId    uint64  `json:"systemId"`
	SystemLabel string  `json:"systemLabel"`
	Reference   uint    `json:"reference"`
	Label       string  `json:"label"`
	Name        string  `json:"name"`
	Calls       int64   `json:"calls"`
	LastCall    int64   `json:"lastCall"`
	Buckets     []int64 `json:"buckets"`
}

type Activity struct {
	Start         int64               `json:"start"`
	End           int64               `json:"end"`
	BucketMinutes int                 `json:"bucketMinutes"`
	TotalCalls    int64               `json:"totalCalls"`
	Systems       []ActivitySystem    `json:"systems"`
	Buckets       []ActivityBucket    `json:"buckets"`
	Talkgroups    []ActivityTalkgroup `json:"talkgroups"`
}

func activityBucketMinutes(hours int) int {
	switch hours {
	case 1:
		return 5
	case 6:
		return 15
	case 24:
		return 30
	case 168:
		return 180
	default:
		return 0
	}
}

func (admin *Admin) ActivityHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if !admin.ValidateToken(admin.GetAuthorization(r)) {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", http.MethodGet)
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	hours := 24
	if value := r.URL.Query().Get("hours"); value != "" {
		parsed, err := strconv.Atoi(value)
		if err != nil || activityBucketMinutes(parsed) == 0 {
			http.Error(w, "hours must be 1, 6, 24 or 168", http.StatusBadRequest)
			return
		}
		hours = parsed
	}
	var systemId uint64
	if value := r.URL.Query().Get("system"); value != "" {
		parsed, err := strconv.ParseUint(value, 10, 63)
		if err != nil {
			http.Error(w, "invalid system", http.StatusBadRequest)
			return
		}
		systemId = parsed
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	activity, err := readActivity(ctx, admin.Controller.Database, hours, systemId, time.Now())
	if err != nil {
		http.Error(w, "Unable to load activity", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(activity)
}

// readActivity counts each stored call once, under its primary talkgroup.
// Patches and unit/frequency metadata must not multiply the counts. The archive
// timestamp is recording time, not arrival time; deleted calls are not included.
// Admin and listener views share the aggregation with separate access policies.
func readActivity(ctx context.Context, db *Database, hours int, systemId uint64, now time.Time) (*Activity, error) {
	return readScopedActivity(ctx, db, hours, systemId, now, nil, false)
}

func readScopedActivity(ctx context.Context, db *Database, hours int, systemId uint64, now time.Time, access *Access, listener bool) (*Activity, error) {
	minutes := activityBucketMinutes(hours)
	if minutes == 0 {
		return nil, fmt.Errorf("unsupported activity range")
	}
	start, end := now.Add(-time.Duration(hours)*time.Hour).UnixMilli(), now.UnixMilli()
	width := int64(minutes) * time.Minute.Milliseconds()
	origin := start / width * width
	count := int((end - origin + width - 1) / width)
	activity := &Activity{
		Start: start, End: end, BucketMinutes: minutes,
		Systems: []ActivitySystem{}, Talkgroups: []ActivityTalkgroup{},
		Buckets: make([]ActivityBucket, count),
	}
	for i := range activity.Buckets {
		activity.Buckets[i] = ActivityBucket{Start: max(start, origin+int64(i)*width), End: min(end, origin+int64(i+1)*width)}
	}
	allowedSystems := map[uint64]bool{}
	scopeFilter := ""
	if access != nil {
		rows, err := db.Sql.QueryContext(ctx, `SELECT t."talkgroupId", t."systemId", s."systemRef", t."talkgroupRef" FROM "talkgroups" t JOIN "systems" s ON s."systemId" = t."systemId"`)
		if err != nil {
			return nil, err
		}
		ids := []string{}
		for rows.Next() {
			var id, systemId uint64
			var systemRef, talkgroupRef uint
			if err := rows.Scan(&id, &systemId, &systemRef, &talkgroupRef); err != nil {
				rows.Close()
				return nil, err
			}
			if access.HasAccess(&Call{System: &System{SystemRef: systemRef}, Talkgroup: &Talkgroup{TalkgroupRef: talkgroupRef}}) {
				ids = append(ids, strconv.FormatUint(id, 10))
				allowedSystems[systemId] = true
			}
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return nil, err
		}
		scopeFilter = " AND 1 = 0"
		if len(ids) > 0 {
			scopeFilter = ` AND c."talkgroupId" IN (` + strings.Join(ids, ",") + ")"
		}
	}
	rows, err := db.Sql.QueryContext(ctx, `SELECT "systemId", "label" FROM "systems" ORDER BY "label", "systemId"`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var system ActivitySystem
		if err := rows.Scan(&system.Id, &system.Label); err != nil {
			rows.Close()
			return nil, err
		}
		if access == nil || allowedSystems[system.Id] {
			activity.Systems = append(activity.Systems, system)
		}
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}

	// Only validated integers enter this expression. Aggregation happens in SQL
	// over a timestamp-leading covering index, without loading any audio blobs.
	bucket := fmt.Sprintf(`(c."timestamp" - %d) / %d`, origin, width)
	if db.Config.DbType == DbTypeMysql || db.Config.DbType == DbTypeMariadb {
		bucket = "FLOOR(" + bucket + ")"
	}
	filter := scopeFilter
	if systemId != 0 {
		filter += fmt.Sprintf(` AND c."systemId" = %d`, systemId)
	}
	if listener {
		// Honour pending releases and configured delays before counting, including
		// the short interval between storing a call and adding it to the delayer.
		filter += fmt.Sprintf(` AND NOT EXISTS (SELECT 1 FROM "delayed" d WHERE d."callId" = c."callId")
			AND EXISTS (SELECT 1 FROM "talkgroups" lt JOIN "systems" ls ON ls."systemId" = lt."systemId"
			WHERE lt."talkgroupId" = c."talkgroupId" AND c."timestamp" <= %d -
			(CASE WHEN lt."delay" > 0 THEN lt."delay" ELSE ls."delay" END) * 60000)`, end)
	}
	query := fmt.Sprintf(`SELECT a.bucket, a.calls, a.latest, t."talkgroupId", t."systemId", s."label", t."talkgroupRef", t."label", t."name"
		FROM (SELECT %s AS bucket, c."systemId", c."talkgroupId", COUNT(*) AS calls, MAX(c."timestamp") AS latest
		FROM "calls" c WHERE c."timestamp" >= %d AND c."timestamp" < %d%s
		GROUP BY %s, c."systemId", c."talkgroupId") a
		JOIN "talkgroups" t ON t."talkgroupId" = a."talkgroupId" AND t."systemId" = a."systemId"
		JOIN "systems" s ON s."systemId" = a."systemId"`, bucket, start, end, filter, bucket)
	rows, err = db.Sql.QueryContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	groups := map[uint64]*ActivityTalkgroup{}
	for rows.Next() {
		var i int
		var calls, latest int64
		var group ActivityTalkgroup
		if err := rows.Scan(&i, &calls, &latest, &group.Id, &group.SystemId, &group.SystemLabel, &group.Reference, &group.Label, &group.Name); err != nil {
			return nil, err
		}
		if i < 0 || i >= count {
			return nil, fmt.Errorf("activity bucket outside requested range")
		}
		if groups[group.Id] == nil {
			group.Buckets = make([]int64, count)
			groups[group.Id] = &group
		}
		g := groups[group.Id]
		g.Buckets[i] += calls
		g.Calls += calls
		g.LastCall = max(g.LastCall, latest)
		activity.Buckets[i].Calls += calls
		activity.TotalCalls += calls
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for _, group := range groups {
		activity.Talkgroups = append(activity.Talkgroups, *group)
	}
	sort.Slice(activity.Talkgroups, func(i, j int) bool {
		a, b := activity.Talkgroups[i], activity.Talkgroups[j]
		if a.Calls != b.Calls {
			return a.Calls > b.Calls
		}
		return a.Id < b.Id
	})
	return activity, nil
}

// Use the existing listener connection so activity never requires an admin
// token or exposes a second, unauthenticated path to restricted call metadata.
func (controller *Controller) ProcessMessageCommandActivity(client *Client, message *Message) error {
	var access *Access
	if controller.Accesses.IsRestricted() {
		if client.Access == nil {
			client.Send <- &Message{Command: MessageCommandPin}
			return nil
		}
		current, ok := controller.Accesses.GetAccess(client.Access.Code)
		if !ok {
			client.Send <- &Message{Command: MessageCommandPin}
			return nil
		}
		if current.HasExpired() {
			client.Send <- &Message{Command: MessageCommandExpired}
			return nil
		}
		access = current
	}
	fail := func() {
		client.Send <- &Message{Command: MessageCommandActivity, Payload: map[string]string{"error": "Unable to load activity"}, Flag: message.Flag}
	}
	payload, ok := message.Payload.(map[string]any)
	if !ok {
		fail()
		return nil
	}
	hours, ok := payload["hours"].(float64)
	if !ok || (hours != 1 && hours != 6 && hours != 24 && hours != 168) {
		fail()
		return nil
	}
	system, ok := payload["system"].(float64)
	if !ok || system < 0 || system > 9007199254740991 || system != float64(uint64(system)) {
		fail()
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	activity, err := readScopedActivity(ctx, controller.Database, int(hours), uint64(system), time.Now(), access, true)
	if err != nil {
		fail()
		return err
	}
	client.Send <- &Message{Command: MessageCommandActivity, Payload: activity, Flag: message.Flag}
	return nil
}
