// Copyright (C) 2019-2026 Chrystian Huot <chrystian.huot@saubeo.solutions>
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

package main

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"math"
	"math/rand"
	"time"
)

const (
	testAudioSampleRate = 8000
	testHistorySize     = 24
)

type testTalkgroup struct {
	systemRef      uint
	systemLabel    string
	talkgroupRef   uint
	talkgroupLabel string
	talkgroupName  string
	groups         []string
	tag            string
	frequency      uint
	patches        []uint
}

var testTalkgroups = []testTalkgroup{
	{1, "Metro Fire", 101, "Dispatch", "Metro Fire Dispatch", []string{"Fire"}, "Fire Dispatch", 466125000, nil},
	{1, "Metro Fire", 102, "Fireground 1", "Metro Fireground 1", []string{"Fire"}, "Fire-Tac", 466225000, nil},
	{1, "Metro Fire", 103, "Rescue", "Rescue Operations", []string{"Fire", "Emergency"}, "Rescue", 466350000, nil},
	{2, "City Services", 201, "Roads", "Road Maintenance", []string{"Public Works"}, "Public Works", 474050000, nil},
	{2, "City Services", 202, "Transit", "Transit Operations", []string{"Transport"}, "Transportation", 474175000, nil},
	{2, "City Services", 203, "Utilities", "Water and Power", []string{"Public Works"}, "Utilities", 474300000, nil},
	{3, "Regional Safety", 301, "Operations", "Regional Operations", []string{"Emergency"}, "Emergency Ops", 488125000, nil},
	{3, "Regional Safety", 302, "Events", "Event Coordination", []string{"Emergency", "Interop"}, "Interop", 488275000, nil},
	{4, "Seasonal Districts", 401, "District 1", "District One Dispatch", []string{"Districts"}, "Law Dispatch", 489125000, []uint{401, 402}},
	{4, "Seasonal Districts", 402, "District 2", "District Two Dispatch", []string{"Districts"}, "Law Dispatch", 489250000, nil},
}

// TestMode produces disposable scanner traffic for exercising the web client.
// Its random source is private because live calls are generated in a goroutine.
type TestMode struct {
	random *rand.Rand
}

func NewTestMode() *TestMode {
	return &TestMode{random: rand.New(rand.NewSource(time.Now().UnixNano()))}
}

// Populate adds enough historical calls for search, filtering, and playback to
// be useful immediately. It uses normal ingestion so the fixtures exercise the
// same persistence and serialization paths as recorder uploads.
func (mode *TestMode) Populate(controller *Controller) error {
	controller.Options.AutoPopulate = true
	controller.Options.AudioConversion = AUDIO_CONVERSION_DISABLED
	controller.Options.DisableDuplicateDetection = true
	controller.Options.Branding = "Ember Scanner — Test Mode"

	now := time.Now()
	patchPrimary := testTalkgroups[len(testTalkgroups)-2]
	patchMember := testTalkgroups[len(testTalkgroups)-1]

	// Exercise the same lifecycle seen when SDRTrunk initially supplies only a
	// patched ID: create its placeholder, then repair it when it becomes primary.
	for i, fixture := range []testTalkgroup{patchPrimary, patchMember} {
		call := mode.newFixtureCall(fixture, now.Add(-time.Duration(testHistorySize-i)*45*time.Second))
		controller.IngestCall(call)
		if call.Id == 0 {
			return fmt.Errorf("test mode could not ingest patch fixture %d", i+1)
		}
	}

	for i := testHistorySize - 2; i > 1; i-- {
		call := mode.newCall(now.Add(-time.Duration(i) * 45 * time.Second))
		controller.IngestCall(call)
		if call.Id == 0 {
			return fmt.Errorf("test mode could not ingest fixture %d", testHistorySize-i)
		}
	}

	// Keep a resolved patched call as the newest history entry so the main UI
	// immediately demonstrates its combined labels, names, IDs, and PATCH flag.
	call := mode.newFixtureCall(patchPrimary, now.Add(-45*time.Second))
	controller.IngestCall(call)
	if call.Id == 0 {
		return fmt.Errorf("test mode could not ingest resolved patch fixture")
	}

	controller.EmitConfig()
	controller.Logs.LogEvent(LogLevelWarn, "test mode enabled: using synthetic data and audio")
	return nil
}

// Start emits a new synthetic transmission every few seconds until the server
// exits, making live playback and client updates testable without a recorder.
func (mode *TestMode) Start(controller *Controller) {
	go func() {
		for {
			delay := time.Duration(4+mode.random.Intn(7)) * time.Second
			timer := time.NewTimer(delay)
			<-timer.C
			controller.Ingest <- mode.newCall(time.Now())
		}
	}()
}

func (mode *TestMode) newCall(timestamp time.Time) *Call {
	fixture := testTalkgroups[mode.random.Intn(len(testTalkgroups))]
	return mode.newFixtureCall(fixture, timestamp)
}

func (mode *TestMode) newFixtureCall(fixture testTalkgroup, timestamp time.Time) *Call {
	duration := 900 + mode.random.Intn(1700)
	frequencyJitter := uint(mode.random.Intn(5)) * 12500
	unitRef := fixture.systemRef*1000 + uint(1+mode.random.Intn(24))

	return &Call{
		Audio:         generateTestWAV(mode.random, testAudioSampleRate, duration),
		AudioFilename: fmt.Sprintf("test-%d-%d.wav", fixture.talkgroupRef, timestamp.UnixMilli()),
		AudioMime:     "audio/wav",
		Patches:       append([]uint(nil), fixture.patches...),
		Frequencies: []CallFrequency{{
			Dbm:       -(45 + mode.random.Intn(45)),
			Errors:    uint(mode.random.Intn(4)),
			Frequency: fixture.frequency + frequencyJitter,
			Offset:    0,
			Spikes:    uint(mode.random.Intn(3)),
		}},
		Meta: CallMeta{
			SystemLabel:     fixture.systemLabel,
			SystemRef:       fixture.systemRef,
			TalkgroupGroups: fixture.groups,
			TalkgroupLabel:  fixture.talkgroupLabel,
			TalkgroupName:   fixture.talkgroupName,
			TalkgroupRef:    fixture.talkgroupRef,
			TalkgroupTag:    fixture.tag,
			ChannelType:     "Test",
			UnitLabels:      []string{fmt.Sprintf("Test Unit %d", unitRef)},
			UnitRefs:        []uint{unitRef},
		},
		Timestamp: timestamp,
		Units: []CallUnit{{
			Offset:  0,
			UnitRef: unitRef,
		}},
	}
}

// generateTestWAV builds a short mono PCM clip with speech-like changing tones
// and low-level noise. It is intentionally dependency-free and browser playable.
func generateTestWAV(random *rand.Rand, sampleRate, durationMs int) []byte {
	sampleCount := sampleRate * durationMs / 1000
	pcm := make([]int16, sampleCount)
	baseFrequency := 260 + random.Float64()*240

	for i := range pcm {
		t := float64(i) / float64(sampleRate)
		segment := float64((i / (sampleRate / 8)) % 5)
		frequency := baseFrequency + segment*38
		envelope := math.Min(1, float64(i)/240) * math.Min(1, float64(sampleCount-i)/240)
		carrier := math.Sin(2*math.Pi*frequency*t) + 0.3*math.Sin(2*math.Pi*frequency*2.03*t)
		noise := (random.Float64()*2 - 1) * 0.08
		pcm[i] = int16((carrier*0.32 + noise) * envelope * math.MaxInt16)
	}

	var wav bytes.Buffer
	dataSize := uint32(len(pcm) * 2)
	wav.WriteString("RIFF")
	binary.Write(&wav, binary.LittleEndian, uint32(36)+dataSize)
	wav.WriteString("WAVEfmt ")
	binary.Write(&wav, binary.LittleEndian, uint32(16))
	binary.Write(&wav, binary.LittleEndian, uint16(1))
	binary.Write(&wav, binary.LittleEndian, uint16(1))
	binary.Write(&wav, binary.LittleEndian, uint32(sampleRate))
	binary.Write(&wav, binary.LittleEndian, uint32(sampleRate*2))
	binary.Write(&wav, binary.LittleEndian, uint16(2))
	binary.Write(&wav, binary.LittleEndian, uint16(16))
	wav.WriteString("data")
	binary.Write(&wav, binary.LittleEndian, dataSize)
	for _, sample := range pcm {
		binary.Write(&wav, binary.LittleEndian, sample)
	}

	return wav.Bytes()
}
