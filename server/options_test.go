// Copyright (C) 2019-2026 Chrystian Huot <chrystian.huot@saubeo.solutions>
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

package main

import "testing"

func TestShowErrorsAndSpikesDefaultsToVisible(t *testing.T) {
	options := NewOptions().FromMap(map[string]any{})

	if !options.ShowErrorsAndSpikes {
		t.Fatal("expected errors and spikes to be visible by default")
	}
}

func TestShowErrorsAndSpikesCanBeDisabled(t *testing.T) {
	options := NewOptions().FromMap(map[string]any{"showErrorsAndSpikes": false})

	if options.ShowErrorsAndSpikes {
		t.Fatal("expected errors and spikes to be hidden")
	}
}
