package main

import (
	"bytes"
	"io"
	"mime/multipart"
	"testing"
)

func parseMultipartField(t *testing.T, call *Call, name, value string) {
	t.Helper()

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	field, err := writer.CreateFormField(name)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := field.Write([]byte(value)); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}

	reader := multipart.NewReader(&body, writer.Boundary())
	part, err := reader.NextPart()
	if err != nil {
		t.Fatal(err)
	}
	data, err := io.ReadAll(part)
	if err != nil {
		t.Fatal(err)
	}
	ParseMultipartContent(call, part, data)
}

func TestParseMultipartUnitsPopulatesCallHistoryAndMetadata(t *testing.T) {
	call := NewCall()
	parseMultipartField(t, call, "units", `[{"id":710618,"label":"Gastonia PD Dispatch","offset":0.03}]`)

	if len(call.Units) != 1 || call.Units[0].UnitRef != 710618 || call.Units[0].Offset != 0.03 {
		t.Fatalf("unexpected call units: %#v", call.Units)
	}
	if len(call.Meta.UnitRefs) != 1 || call.Meta.UnitRefs[0] != 710618 {
		t.Fatalf("unexpected unit refs: %#v", call.Meta.UnitRefs)
	}
	if len(call.Meta.UnitLabels) != 1 || call.Meta.UnitLabels[0] != "Gastonia PD Dispatch" {
		t.Fatalf("unexpected unit labels: %#v", call.Meta.UnitLabels)
	}
}

func TestParseMultipartChannelTypePreservesConventionalMetadata(t *testing.T) {
	call := NewCall()
	parseMultipartField(t, call, "channelType", "conventional")
	parseMultipartField(t, call, "talkgroupLabel", "GASTON-FIRE")

	if call.Meta.ChannelType != "conventional" {
		t.Fatalf("channel type = %q, want conventional", call.Meta.ChannelType)
	}
	if call.Meta.TalkgroupLabel != "GASTON-FIRE" {
		t.Fatalf("talkgroup label = %q, want GASTON-FIRE", call.Meta.TalkgroupLabel)
	}
}

func TestParseMultipartUnknownChannelTypeIsIgnored(t *testing.T) {
	call := NewCall()
	parseMultipartField(t, call, "channelType", "frequency-ish")

	if call.Meta.ChannelType != "" {
		t.Fatalf("unknown channel type = %q, want empty", call.Meta.ChannelType)
	}
}

func TestParseMultipartUnlabeledUnitDoesNotInventMetadata(t *testing.T) {
	call := NewCall()
	parseMultipartField(t, call, "units", `[{"id":710618,"offset":0.03}]`)

	if len(call.Units) != 1 || call.Units[0].UnitRef != 710618 || call.Units[0].Offset != 0.03 {
		t.Fatalf("unexpected call units: %#v", call.Units)
	}
	if len(call.Meta.UnitRefs) != 0 || len(call.Meta.UnitLabels) != 0 {
		t.Fatalf("unlabeled unit produced metadata: refs=%#v labels=%#v", call.Meta.UnitRefs, call.Meta.UnitLabels)
	}
}

func TestParseMultipartUnitsKeepsMultipleLabelsPairedAndDeduplicated(t *testing.T) {
	call := NewCall()
	parseMultipartField(t, call, "units", `[
		{"id":100,"label":"Engine 1","offset":0.01},
		{"id":200,"label":"Engine 2","offset":0.02},
		{"id":100,"label":"Engine 1 duplicate","offset":0.03}
	]`)

	if len(call.Units) != 3 {
		t.Fatalf("unexpected call unit history: %#v", call.Units)
	}
	if got, want := call.Meta.UnitRefs, []uint{100, 200}; !equalUintSlices(got, want) {
		t.Fatalf("unit refs = %#v, want %#v", got, want)
	}
	if got, want := call.Meta.UnitLabels, []string{"Engine 1", "Engine 2"}; !equalStringSlices(got, want) {
		t.Fatalf("unit labels = %#v, want %#v", got, want)
	}
}

func TestParseMultipartUnitsMixLabeledAndUnlabeled(t *testing.T) {
	call := NewCall()
	parseMultipartField(t, call, "units", `[
		{"id":100,"label":"Engine 1","offset":0.01},
		{"id":200,"offset":0.02},
		{"id":300,"label":"Engine 3","offset":0.03}
	]`)

	if len(call.Units) != 3 {
		t.Fatalf("unexpected call unit history: %#v", call.Units)
	}
	if got, want := call.Meta.UnitRefs, []uint{100, 300}; !equalUintSlices(got, want) {
		t.Fatalf("unit refs = %#v, want %#v", got, want)
	}
	if got, want := call.Meta.UnitLabels, []string{"Engine 1", "Engine 3"}; !equalStringSlices(got, want) {
		t.Fatalf("unit labels = %#v, want %#v", got, want)
	}
}

func TestParseMultipartMalformedUnitLabelsDoNotBreakHistory(t *testing.T) {
	call := NewCall()
	parseMultipartField(t, call, "units", `[
		{"id":100,"label":123,"offset":0.01},
		{"id":200,"label":"","offset":0.02},
		{"id":300,"label":null,"offset":0.03},
		{"id":400,"label":"Valid","offset":0.04}
	]`)

	if len(call.Units) != 4 {
		t.Fatalf("malformed label changed call history: %#v", call.Units)
	}
	if got, want := call.Meta.UnitRefs, []uint{400}; !equalUintSlices(got, want) {
		t.Fatalf("unit refs = %#v, want %#v", got, want)
	}
	if got, want := call.Meta.UnitLabels, []string{"Valid"}; !equalStringSlices(got, want) {
		t.Fatalf("unit labels = %#v, want %#v", got, want)
	}
}

func TestParseMultipartLegacySourceAndSourcesRemainCompatible(t *testing.T) {
	call := NewCall()
	parseMultipartField(t, call, "source", "42")
	parseMultipartField(t, call, "sources", `[
		{"src":42,"pos":0.01},
		{"src":43,"pos":0.02,"tag":"Legacy Unit"}
	]`)

	if len(call.Units) != 3 || call.Units[0].UnitRef != 42 || call.Units[1].UnitRef != 42 || call.Units[2].UnitRef != 43 {
		t.Fatalf("unexpected legacy call units: %#v", call.Units)
	}
	if got, want := call.Meta.UnitRefs, []uint{43}; !equalUintSlices(got, want) {
		t.Fatalf("legacy unit refs = %#v, want %#v", got, want)
	}
	if got, want := call.Meta.UnitLabels, []string{"Legacy Unit"}; !equalStringSlices(got, want) {
		t.Fatalf("legacy unit labels = %#v, want %#v", got, want)
	}
}

func equalUintSlices(a, b []uint) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func equalStringSlices(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
