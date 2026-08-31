package main

import "testing"

func TestLivefeedActiveTalkgroupsReturnsOnlyEnabledSelections(t *testing.T) {
	livefeed := NewLivefeed().FromMap(map[string]any{
		"1": map[string]any{
			"10": true,
			"11": false,
		},
		"2": map[string]any{
			"20": true,
		},
	})

	active := livefeed.ActiveTalkgroups()
	if len(active) != 2 {
		t.Fatalf("expected two active systems, got %d", len(active))
	}
	if len(active[1]) != 1 || active[1][0] != 10 {
		t.Fatalf("expected only talkgroup 10 for system 1, got %v", active[1])
	}
	if len(active[2]) != 1 || active[2][0] != 20 {
		t.Fatalf("expected only talkgroup 20 for system 2, got %v", active[2])
	}
}

func TestLivefeedActiveTalkgroupsReturnsSnapshot(t *testing.T) {
	livefeed := NewLivefeed().FromMap(map[string]any{
		"1": map[string]any{"10": true},
	})

	active := livefeed.ActiveTalkgroups()
	active[1][0] = 99

	current := livefeed.ActiveTalkgroups()
	if current[1][0] != 10 {
		t.Fatalf("expected livefeed selection to remain unchanged, got %v", current[1])
	}
}

func TestCallSearchOptionsParsesLivefeedFilter(t *testing.T) {
	options := NewCallSearchOptions().fromMap(map[string]any{"livefeed": true})

	if !options.Livefeed {
		t.Fatal("expected livefeed history filtering to be enabled")
	}
}
