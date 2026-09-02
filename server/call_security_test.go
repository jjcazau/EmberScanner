package main

import (
	"testing"
	"time"
)

func TestWriteCallPreservesQuotedFilenameAndMime(t *testing.T) {
	controller := newUnitIngestController(t)
	db := controller.Database

	tagResult, err := db.Sql.Exec(`INSERT INTO "tags" ("label") VALUES (?)`, "Security test")
	if err != nil {
		t.Fatal(err)
	}
	tagID, err := tagResult.LastInsertId()
	if err != nil {
		t.Fatal(err)
	}
	systemResult, err := db.Sql.Exec(`INSERT INTO "systems" ("label", "systemRef") VALUES (?, ?)`, "Security test", 9876)
	if err != nil {
		t.Fatal(err)
	}
	systemID, err := systemResult.LastInsertId()
	if err != nil {
		t.Fatal(err)
	}
	talkgroupResult, err := db.Sql.Exec(`INSERT INTO "talkgroups" ("label", "name", "systemId", "tagId", "talkgroupRef") VALUES (?, ?, ?, ?, ?)`, "Security test", "Security test", systemID, tagID, 5432)
	if err != nil {
		t.Fatal(err)
	}
	talkgroupID, err := talkgroupResult.LastInsertId()
	if err != nil {
		t.Fatal(err)
	}

	wantFilename := "dispatch's recording.wav"
	wantMime := "audio/x-test'; DROP TABLE calls; --"
	call := NewCall()
	call.Audio = bytesForSecurityTest(45)
	call.AudioFilename = wantFilename
	call.AudioMime = wantMime
	call.System = &System{Id: uint64(systemID)}
	call.Talkgroup = &Talkgroup{Id: uint64(talkgroupID)}
	call.Timestamp = time.Now().UTC()

	callID, err := controller.Calls.WriteCall(call, db)
	if err != nil {
		t.Fatal(err)
	}

	var gotFilename, gotMime string
	if err := db.Sql.QueryRow(`SELECT "audioFilename", "audioMime" FROM "calls" WHERE "callId" = ?`, callID).Scan(&gotFilename, &gotMime); err != nil {
		t.Fatal(err)
	}
	if gotFilename != wantFilename || gotMime != wantMime {
		t.Fatalf("stored filename/MIME = %q/%q, want %q/%q", gotFilename, gotMime, wantFilename, wantMime)
	}
}

func bytesForSecurityTest(size int) []byte {
	b := make([]byte, size)
	for i := range b {
		b[i] = byte(i)
	}
	return b
}
