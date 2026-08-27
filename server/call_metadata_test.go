package main

import (
	"encoding/json"
	"testing"
)

func TestCallJSONPreservesConventionalDisplayMetadata(t *testing.T) {
	call := NewCall()
	call.Id = 9
	call.AudioFilename = "call.m4a"
	call.AudioMime = "audio/mp4"
	call.Talkgroup = &Talkgroup{
		TalkgroupRef: 1514000,
		Label:        "GASTON-FIRE",
		Name:         "GASTON-FIRE",
	}
	call.Meta.ChannelType = "conventional"
	call.Frequencies = append(call.Frequencies, CallFrequency{Frequency: 151400000})

	var payload map[string]any
	encoded, err := json.Marshal(call)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(encoded, &payload); err != nil {
		t.Fatal(err)
	}

	if payload["channelType"] != "conventional" {
		t.Fatalf("channel type = %#v", payload["channelType"])
	}
	if payload["talkgroupLabel"] != "GASTON-FIRE" {
		t.Fatalf("talkgroup label = %#v", payload["talkgroupLabel"])
	}
	if payload["talkgroupName"] != "GASTON-FIRE" {
		t.Fatalf("talkgroup name = %#v", payload["talkgroupName"])
	}
}
