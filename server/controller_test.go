package main

import "testing"

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
