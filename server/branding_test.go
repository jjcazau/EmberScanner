package main

import (
	"encoding/json"
	"testing"
)

func TestBrandingSubheadingPersistsAndReachesListener(t *testing.T) {
	controller := newUnitIngestController(t)
	client := &Client{Access: NewAccess(), Send: make(chan *Message, 1)}

	if controller.Options.BrandingSubheading != "" {
		t.Fatal("existing installations should have no subheading")
	}

	for _, text := range []string{"District's radio — North", "Updated subheading", ""} {
		controller.Options.FromMap(map[string]any{"brandingSubheading": text})
		if err := controller.Options.Write(controller.Database); err != nil {
			t.Fatal(err)
		}
		loaded := NewOptions()
		if err := loaded.Read(controller.Database); err != nil {
			t.Fatal(err)
		}
		if loaded.BrandingSubheading != text {
			t.Fatalf("reloaded subheading = %q, want %q", loaded.BrandingSubheading, text)
		}
		controller.Options = loaded

		// The admin configuration/export includes the stored value.
		encoded, err := json.Marshal(loaded)
		if err != nil {
			t.Fatal(err)
		}
		var exported map[string]any
		if err := json.Unmarshal(encoded, &exported); err != nil {
			t.Fatal(err)
		}
		if exported["brandingSubheading"] != text {
			t.Fatalf("exported subheading = %v, want %q", exported["brandingSubheading"], text)
		}

		// Branding must reach the PIN screen before listener authentication.
		controller.ProcessMessageCommandVersion(client)
		version := <-client.Send
		if got := version.Payload.(map[string]string)["brandingSubheading"]; got != text {
			t.Fatalf("public subheading = %q, want %q", got, text)
		}

		client.SendConfig(controller.Groups, loaded, controller.Systems, controller.Tags)
		config := <-client.Send
		if got := config.Payload.(map[string]any)["brandingSubheading"]; got != text {
			t.Fatalf("listener subheading = %v, want %q", got, text)
		}
	}
}
