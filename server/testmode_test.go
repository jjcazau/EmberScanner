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
