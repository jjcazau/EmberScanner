package main

import (
	"testing"
	"time"
)

func TestCallIsValidCompatibilityError(t *testing.T) {
	validAudio := make([]byte, 45)
	validTimestamp := time.Now()

	tests := []struct {
		name string
		call *Call
	}{
		{
			name: "completely empty call",
			call: NewCall(),
		},
		{
			name: "only audio is valid",
			call: &Call{Audio: validAudio},
		},
		{
			name: "talkgroup is missing",
			call: &Call{
				Audio:     validAudio,
				Timestamp: validTimestamp,
				System:    &System{},
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			ok, err := test.call.IsValid()
			if ok {
				t.Fatal("IsValid() returned ok = true")
			}
			if err == nil || err.Error() != "no talkgroup" {
				t.Fatalf("IsValid() error = %v, want no talkgroup", err)
			}
		})
	}
}

func TestCallIsValidFullyValid(t *testing.T) {
	call := &Call{
		Audio:     make([]byte, 45),
		Timestamp: time.Now(),
		System:    &System{},
		Talkgroup: &Talkgroup{},
	}

	ok, err := call.IsValid()
	if !ok {
		t.Fatalf("IsValid() returned ok = false, error = %v", err)
	}
	if err != nil {
		t.Fatalf("IsValid() error = %v, want nil", err)
	}
}

func TestCallIsValidWithMetadata(t *testing.T) {
	call := &Call{
		Audio:     make([]byte, 45),
		Timestamp: time.Now(),
		Meta: CallMeta{
			SystemRef:    1,
			TalkgroupRef: 2,
		},
	}

	ok, err := call.IsValid()
	if !ok {
		t.Fatalf("IsValid() returned ok = false, error = %v", err)
	}
	if err != nil {
		t.Fatalf("IsValid() error = %v, want nil", err)
	}
}
