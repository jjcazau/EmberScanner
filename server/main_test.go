// Copyright (C) 2019-2026 Chrystian Huot <chrystian.huot@saubeo.solutions>
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

package main

import (
	"crypto/tls"
	"net/http"
	"net/http/httptest"
	"strings"
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

func TestGetRemoteAddrIgnoresForwardedHeaders(t *testing.T) {
	tests := []struct {
		name       string
		remoteAddr string
		want       string
	}{
		{name: "IPv4 with port", remoteAddr: "192.0.2.10:1234", want: "192.0.2.10"},
		{name: "IPv6 with port", remoteAddr: "[2001:db8::1]:1234", want: "2001:db8::1"},
		{name: "IPv6 without port", remoteAddr: "2001:db8::1", want: "2001:db8::1"},
		{name: "host without port", remoteAddr: "localhost", want: "localhost"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, "/", nil)
			request.RemoteAddr = test.remoteAddr
			request.Header.Set("X-Forwarded-For", "203.0.113.1")

			if got := GetRemoteAddr(request); got != test.want {
				t.Errorf("GetRemoteAddr() = %q, want %q", got, test.want)
			}
		})
	}
}

func TestSecurityHeaders(t *testing.T) {
	tests := []struct {
		name     string
		tls      bool
		wantHSTS bool
	}{
		{name: "HTTP"},
		{name: "HTTPS", tls: true, wantHSTS: true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, "/admin", nil)
			if test.tls {
				request.TLS = &tls.ConnectionState{}
			}
			response := httptest.NewRecorder()

			securityHeaders(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(http.StatusNoContent)
			})).ServeHTTP(response, request)

			for _, header := range []string{
				"Content-Security-Policy",
				"Referrer-Policy",
				"X-Content-Type-Options",
				"X-Frame-Options",
			} {
				if got := response.Header().Get(header); got == "" {
					t.Errorf("%s header is missing", header)
				}
			}

			gotHSTS := response.Header().Get("Strict-Transport-Security") != ""
			if gotHSTS != test.wantHSTS {
				t.Errorf("Strict-Transport-Security present = %t, want %t", gotHSTS, test.wantHSTS)
			}
		})
	}
}

func TestSecurityHeadersPreservePublicIframeSupport(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/", nil)
	response := httptest.NewRecorder()

	securityHeaders(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})).ServeHTTP(response, request)

	if got := response.Header().Get("X-Frame-Options"); got != "" {
		t.Fatalf("public X-Frame-Options = %q, want empty for documented iframe support", got)
	}
	if got := response.Header().Get("Content-Security-Policy"); strings.Contains(got, "frame-ancestors") {
		t.Fatalf("public CSP unexpectedly blocks documented iframe support: %q", got)
	}
}
