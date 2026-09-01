package main

import (
	"encoding/binary"
	"math/rand"
	"testing"
	"time"
)

func TestGenerateTestWAV(t *testing.T) {
	random := rand.New(rand.NewSource(1))
	wav := generateTestWAV(random, 8000, 1000)

	if string(wav[:4]) != "RIFF" || string(wav[8:12]) != "WAVE" {
		t.Fatal("generated audio is not a WAV file")
	}
	if got, want := binary.LittleEndian.Uint32(wav[24:28]), uint32(8000); got != want {
		t.Fatalf("sample rate = %d, want %d", got, want)
	}
	if got, want := len(wav), 44+8000*2; got != want {
		t.Fatalf("WAV length = %d, want %d", got, want)
	}
	if got, want := int(binary.LittleEndian.Uint32(wav[40:44])), 8000*2; got != want {
		t.Fatalf("PCM data length = %d, want %d", got, want)
	}
}

func TestTestModeCallIsValid(t *testing.T) {
	mode := &TestMode{random: rand.New(rand.NewSource(2))}
	call := mode.newCall(time.Unix(1_700_000_000, 0))

	if ok, err := call.IsValid(); !ok {
		t.Fatalf("test call is invalid: %v", err)
	}
	if call.AudioMime != "audio/wav" {
		t.Fatalf("audio MIME = %q, want audio/wav", call.AudioMime)
	}
	if len(call.Frequencies) == 0 || len(call.Units) == 0 {
		t.Fatal("test call is missing frequency or unit metadata")
	}
}

func TestTestModePatchFixture(t *testing.T) {
	mode := &TestMode{random: rand.New(rand.NewSource(3))}
	fixture := testTalkgroups[len(testTalkgroups)-2]
	call := mode.newFixtureCall(fixture, time.Unix(1_700_000_000, 0))

	if len(call.Patches) != 2 || call.Patches[0] != 401 || call.Patches[1] != 402 {
		t.Fatalf("patch fixture = %#v, want [401 402]", call.Patches)
	}

	call.Patches[0] = 999
	if fixture.patches[0] != 401 {
		t.Fatal("test call mutated the shared patch fixture")
	}
}

func TestTestModePopulateIncludesResolvedPatchHistory(t *testing.T) {
	controller := newUnitIngestController(t)
	mode := &TestMode{random: rand.New(rand.NewSource(4))}

	if err := mode.Populate(controller); err != nil {
		t.Fatalf("Populate() error = %v", err)
	}

	system, ok := controller.Systems.GetSystemByRef(4)
	if !ok {
		t.Fatal("seasonal patch system was not populated")
	}
	member, ok := system.Talkgroups.GetTalkgroupByRef(402)
	if !ok || member.Label != "District 2" || member.Name != "District Two Dispatch" {
		t.Fatalf("resolved patch member = %#v, found=%v", member, ok)
	}

	var calls, patches int
	if err := controller.Database.Sql.QueryRow(`SELECT COUNT(*) FROM "calls"`).Scan(&calls); err != nil {
		t.Fatalf("count calls: %v", err)
	}
	if err := controller.Database.Sql.QueryRow(`SELECT COUNT(*) FROM "callPatches" AS cp JOIN "talkgroups" AS t ON t."talkgroupId" = cp."talkgroupId" WHERE t."talkgroupRef" = 402`).Scan(&patches); err != nil {
		t.Fatalf("count patches: %v", err)
	}
	if calls != testHistorySize || patches == 0 {
		t.Fatalf("test history calls=%d patches=%d", calls, patches)
	}
}
