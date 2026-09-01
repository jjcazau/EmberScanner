// Copyright (C) 2019-2026 Chrystian Huot <chrystian.huot@saubeo.solutions>
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

package main

import (
	"net/http/httptest"
	"testing"
)

func TestWriteWebappFileCacheHeaders(t *testing.T) {
	tests := []struct {
		url          string
		cacheControl string
		contentType  string
	}{
		{url: "index.html", cacheControl: "no-store", contentType: "text/html; charset=utf-8"},
		{url: "ngsw-worker.js", cacheControl: "no-cache", contentType: "text/javascript"},
		{url: "main.123456.js", contentType: "text/javascript"},
	}

	for _, test := range tests {
		t.Run(test.url, func(t *testing.T) {
			response := httptest.NewRecorder()

			writeWebappFile(response, test.url, []byte("contents"))

			if got := response.Header().Get("Cache-Control"); got != test.cacheControl {
				t.Errorf("Cache-Control = %q, want %q", got, test.cacheControl)
			}
			if got := response.Header().Get("Content-Type"); got != test.contentType {
				t.Errorf("Content-Type = %q, want %q", got, test.contentType)
			}
		})
	}
}
