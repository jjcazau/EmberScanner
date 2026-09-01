package main

import (
	"testing"
	"time"
)

func newUnitIngestController(t *testing.T) *Controller {
	t.Helper()

	config := &Config{
		BaseDir:    t.TempDir(),
		ConfigFile: "test.ini",
		DbType:     DbTypeSqlite,
		DbFile:     "test.db",
	}
	controller := NewController(config)
	t.Cleanup(func() {
		controller.Database.Sql.Close()
	})
	return controller
}

func ingestUnitMetadata(t *testing.T, refs []uint, labels []string, existing []*Unit) *System {
	t.Helper()

	controller := newUnitIngestController(t)
	system := NewSystem()
	system.SystemRef = 1
	system.Label = "Test System"
	system.AutoPopulate = true
	system.Units.List = append(system.Units.List, existing...)

	talkgroup := NewTalkgroup()
	talkgroup.TalkgroupRef = 123
	talkgroup.Label = "Test Talkgroup"
	talkgroup.Name = "Test Talkgroup"
	system.Talkgroups.List = append(system.Talkgroups.List, talkgroup)
	controller.Systems.List = append(controller.Systems.List, system)

	call := NewCall()
	call.Audio = make([]byte, 45)
	call.AudioFilename = "test.wav"
	call.System = system
	call.Talkgroup = talkgroup
	call.Meta.UnitRefs = refs
	call.Meta.UnitLabels = labels
	for _, ref := range refs {
		call.Units = append(call.Units, CallUnit{UnitRef: ref})
	}

	controller.IngestCall(call)

	updated, ok := controller.Systems.GetSystemByRef(system.SystemRef)
	if !ok {
		t.Fatal("ingested system was not reloaded")
	}
	return updated
}

func unitByRef(system *System, ref uint) (*Unit, bool) {
	for _, unit := range system.Units.List {
		if unit.UnitRef == ref {
			return unit, true
		}
	}
	return nil, false
}

func TestIngestCallAddsOneLabeledUnit(t *testing.T) {
	system := ingestUnitMetadata(t, []uint{710618}, []string{"Gastonia PD Dispatch"}, nil)

	unit, ok := unitByRef(system, 710618)
	if !ok || unit.Label != "Gastonia PD Dispatch" {
		t.Fatalf("unit = %#v, found=%v", unit, ok)
	}
}

func TestIngestCallAddsTwoLabeledUnits(t *testing.T) {
	system := ingestUnitMetadata(t, []uint{100, 200}, []string{"Engine 1", "Engine 2"}, nil)

	for ref, label := range map[uint]string{100: "Engine 1", 200: "Engine 2"} {
		unit, ok := unitByRef(system, ref)
		if !ok || unit.Label != label {
			t.Fatalf("unit %d = %#v, found=%v", ref, unit, ok)
		}
	}
}

func TestIngestCallMissingLabelDoesNotCreateBogusUnit(t *testing.T) {
	system := ingestUnitMetadata(t, []uint{100, 200}, []string{"Engine 1"}, nil)

	if unit, ok := unitByRef(system, 100); !ok || unit.Label != "Engine 1" {
		t.Fatalf("labeled unit = %#v, found=%v", unit, ok)
	}
	if _, ok := unitByRef(system, 200); ok {
		t.Fatal("missing label created a bogus unit")
	}
}

func TestIngestCallPreservesExistingUnitBehavior(t *testing.T) {
	existing := &Unit{UnitRef: 100, Label: "Existing Engine"}
	system := ingestUnitMetadata(t, []uint{100}, []string{"Existing Engine"}, []*Unit{existing})

	if len(system.Units.List) != 1 {
		t.Fatalf("existing unit was duplicated: %#v", system.Units.List)
	}
	if system.Units.List[0].UnitRef != 100 || system.Units.List[0].Label != "Existing Engine" {
		t.Fatalf("existing unit changed: %#v", system.Units.List[0])
	}
}

func TestIngestCallRepairsGeneratedTalkgroupLabel(t *testing.T) {
	controller := newUnitIngestController(t)
	system := NewSystem()
	system.SystemRef = 4
	system.Label = "Gaston County Conventional"
	system.AutoPopulate = true
	talkgroup := NewTalkgroup()
	talkgroup.TalkgroupRef = 1514000
	talkgroup.Label = "1514000"
	talkgroup.Name = "Talkgroup 1514000"
	system.Talkgroups.List = append(system.Talkgroups.List, talkgroup)
	controller.Systems.List = append(controller.Systems.List, system)

	call := NewCall()
	call.Audio = make([]byte, 45)
	call.AudioFilename = "conventional.wav"
	call.System = system
	call.Talkgroup = talkgroup
	call.Meta.TalkgroupLabel = "GASTON-FIRE"
	call.Meta.ChannelType = "conventional"

	controller.IngestCall(call)

	updated, ok := controller.Systems.GetSystemByRef(system.SystemRef)
	if !ok {
		t.Fatal("ingested system was not reloaded")
	}
	got, ok := updated.Talkgroups.GetTalkgroupByRef(1514000)
	if !ok || got.Label != "GASTON-FIRE" {
		t.Fatalf("talkgroup = %#v, found=%v", got, ok)
	}
}

func TestAutoPopulatedTalkgroupNameUsesGroupAndAlias(t *testing.T) {
	got := autoPopulatedTalkgroupName([]string{"Fire Dispatch"}, "GASTON-FIRE", 1514000)
	if got != "Fire Dispatch GASTON-FIRE" {
		t.Fatalf("name = %q, want %q", got, "Fire Dispatch GASTON-FIRE")
	}
}

func TestAutoPopulatedTalkgroupNameFallsBackWithoutGroup(t *testing.T) {
	got := autoPopulatedTalkgroupName([]string{"Unknown"}, "GASTON-FIRE", 1514000)
	if got != "Talkgroup 1514000" {
		t.Fatalf("name = %q, want %q", got, "Talkgroup 1514000")
	}
}

func newPatchedIngestCall(system *System, talkgroup *Talkgroup, patches []uint) *Call {
	call := NewCall()
	call.Audio = make([]byte, 45)
	call.AudioFilename = "patched.wav"
	call.AudioMime = "audio/wav"
	call.System = system
	call.Talkgroup = talkgroup
	call.Patches = patches
	call.Timestamp = time.Unix(1_700_000_000, 0)
	return call
}

func newPersistedPatchTestSystem(t *testing.T, autoPopulate bool) (*Controller, *System, *Talkgroup) {
	t.Helper()

	controller := newUnitIngestController(t)
	controller.Options.AutoPopulate = true
	controller.Options.DisableDuplicateDetection = true

	seed := NewCall()
	seed.Audio = make([]byte, 45)
	seed.AudioFilename = "district-1.wav"
	seed.AudioMime = "audio/wav"
	seed.Meta.SystemRef = 1
	seed.Meta.SystemLabel = "Seasonal Districts"
	seed.Meta.TalkgroupRef = 101
	seed.Meta.TalkgroupLabel = "District 1"
	seed.Meta.TalkgroupName = "District One Dispatch"
	seed.Meta.TalkgroupGroups = []string{"Districts"}
	seed.Meta.TalkgroupTag = "Law Dispatch"
	seed.Timestamp = time.Unix(1_699_999_999, 0)
	controller.IngestCall(seed)
	if seed.Id == 0 {
		t.Fatal("could not seed persisted patch test system")
	}

	controller.Options.AutoPopulate = false
	system, ok := controller.Systems.GetSystemByRef(1)
	if !ok {
		t.Fatal("seeded system was not reloaded")
	}
	system.AutoPopulate = autoPopulate
	primary, ok := system.Talkgroups.GetTalkgroupByRef(101)
	if !ok {
		t.Fatal("seeded primary talkgroup was not reloaded")
	}

	return controller, system, primary
}

func TestIngestCallAutoPopulatesAndPersistsPatchedTalkgroups(t *testing.T) {
	controller, system, primary := newPersistedPatchTestSystem(t, true)

	call := newPatchedIngestCall(system, primary, []uint{101, 202, 202, 0})
	controller.IngestCall(call)

	updated, ok := controller.Systems.GetSystemByRef(system.SystemRef)
	if !ok {
		t.Fatal("ingested system was not reloaded")
	}
	placeholder, ok := updated.Talkgroups.GetTalkgroupByRef(202)
	if !ok {
		t.Fatal("patched talkgroup was not auto-populated")
	}
	if placeholder.Label != "202" || placeholder.Name != "Talkgroup 202" {
		t.Fatalf("patched placeholder = %#v", placeholder)
	}
	if len(call.Patches) != 2 || call.Patches[0] != 101 || call.Patches[1] != 202 {
		t.Fatalf("normalized patches = %#v, want [101 202]", call.Patches)
	}

	stored, err := controller.Calls.GetCall(call.Id)
	if err != nil {
		t.Fatalf("GetCall() error = %v", err)
	}
	if len(stored.Patches) != 2 {
		t.Fatalf("stored patches = %#v, want both patch members", stored.Patches)
	}
}

func TestIngestCallDoesNotAutoPopulatePatchedTalkgroupsWhenDisabled(t *testing.T) {
	controller, system, primary := newPersistedPatchTestSystem(t, false)

	call := newPatchedIngestCall(system, primary, []uint{202})
	controller.IngestCall(call)

	if _, ok := system.Talkgroups.GetTalkgroupByRef(202); ok {
		t.Fatal("patched talkgroup was created while auto-populate was disabled")
	}
}

func TestIngestCallUpgradesPatchedTalkgroupPlaceholder(t *testing.T) {
	controller, system, primary := newPersistedPatchTestSystem(t, true)

	controller.IngestCall(newPatchedIngestCall(system, primary, []uint{202}))
	reloaded, _ := controller.Systems.GetSystemByRef(system.SystemRef)
	placeholder, ok := reloaded.Talkgroups.GetTalkgroupByRef(202)
	if !ok {
		t.Fatal("patched placeholder was not created")
	}

	upgrade := newPatchedIngestCall(reloaded, placeholder, nil)
	upgrade.AudioFilename = "district-2.wav"
	upgrade.Timestamp = upgrade.Timestamp.Add(time.Second)
	upgrade.Meta.TalkgroupLabel = "District 2"
	upgrade.Meta.TalkgroupName = "District Two Dispatch"
	upgrade.Meta.TalkgroupGroups = []string{"Districts"}
	upgrade.Meta.TalkgroupTag = "Law Dispatch"
	controller.IngestCall(upgrade)

	updated, _ := controller.Systems.GetSystemByRef(system.SystemRef)
	got, ok := updated.Talkgroups.GetTalkgroupByRef(202)
	if !ok || got.Label != "District 2" || got.Name != "District Two Dispatch" {
		t.Fatalf("upgraded talkgroup = %#v, found=%v", got, ok)
	}
	if group, ok := controller.Groups.GetGroupByLabel("Districts"); !ok || len(got.GroupIds) != 1 || got.GroupIds[0] != group.Id {
		t.Fatalf("upgraded groups = %#v", got.GroupIds)
	}
	if tag, ok := controller.Tags.GetTagByLabel("Law Dispatch"); !ok || got.TagId != tag.Id {
		t.Fatalf("upgraded tag = %d", got.TagId)
	}
}
