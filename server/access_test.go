// Copyright (C) 2019-2026 Chrystian Huot <chrystian.huot@saubeo.solutions>
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

package main

import "testing"

func TestIsNumericAccessCode(t *testing.T) {
	tests := []struct {
		code  string
		valid bool
	}{
		{code: "0", valid: true},
		{code: "012345", valid: true},
		{code: "", valid: false},
		{code: "123a", valid: false},
		{code: "12 34", valid: false},
		{code: "１２３４", valid: false},
	}

	for _, test := range tests {
		if got := isNumericAccessCode(test.code); got != test.valid {
			t.Errorf("isNumericAccessCode(%q) = %t, want %t", test.code, got, test.valid)
		}
	}
}

func TestAccessesFromMapRejectsNonNumericCodeWithoutReplacingList(t *testing.T) {
	accesses := NewAccesses()
	accesses.List = []*Access{{Code: "1234", Ident: "existing"}}

	valid := accesses.FromMap([]any{
		map[string]any{"code": "12AB", "ident": "invalid", "systems": "*"},
	})

	if valid {
		t.Fatal("expected non-numeric access code to be rejected")
	}
	if len(accesses.List) != 1 || accesses.List[0].Ident != "existing" {
		t.Fatal("invalid access configuration replaced the existing list")
	}
}
