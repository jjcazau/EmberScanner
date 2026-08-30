// Copyright (C) 2019-2026 Chrystian Huot <chrystian.huot@saubeo.solutions>
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

package main

import "testing"

func TestAuthLimiterLocksByIPAtConfiguredMaximum(t *testing.T) {
	limiter := NewAuthLimiter()

	if retryAfter := limiter.Failed("192.0.2.1", 3); retryAfter != 0 {
		t.Fatal("first failed attempt unexpectedly locked the IP")
	}
	if retryAfter := limiter.Failed("192.0.2.1", 3); retryAfter != 0 {
		t.Fatal("second failed attempt unexpectedly locked the IP")
	}
	if retryAfter := limiter.Failed("192.0.2.2", 3); retryAfter != 0 {
		t.Fatal("attempts from a different IP were combined")
	}
	if retryAfter := limiter.Failed("192.0.2.1", 3); retryAfter <= 0 {
		t.Fatal("third failed attempt did not lock the IP")
	}
	if retryAfter := limiter.RetryAfter("192.0.2.1", 3); retryAfter <= 0 {
		t.Fatal("locked IP did not report a retry delay")
	}
}

func TestAuthLimiterResetAfterSuccess(t *testing.T) {
	limiter := NewAuthLimiter()

	limiter.Failed("192.0.2.1", 2)
	limiter.Reset("192.0.2.1")

	if retryAfter := limiter.Failed("192.0.2.1", 2); retryAfter != 0 {
		t.Fatal("attempt count was not reset")
	}
}
