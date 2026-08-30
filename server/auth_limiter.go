// Copyright (C) 2019-2026 Chrystian Huot <chrystian.huot@saubeo.solutions>
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

package main

import (
	"sync"
	"time"
)

const pinAttemptWindow = 15 * time.Minute

type authAttempt struct {
	count     uint
	expiresAt time.Time
}

type AuthLimiter struct {
	attempts map[string]authAttempt
	mutex    sync.Mutex
}

func NewAuthLimiter() *AuthLimiter {
	return &AuthLimiter{
		attempts: map[string]authAttempt{},
	}
}

func (limiter *AuthLimiter) Failed(ip string, maximum uint) time.Duration {
	limiter.mutex.Lock()
	defer limiter.mutex.Unlock()

	if maximum == 0 {
		delete(limiter.attempts, ip)
		return 0
	}

	now := time.Now()
	for key, attempt := range limiter.attempts {
		if !attempt.expiresAt.After(now) {
			delete(limiter.attempts, key)
		}
	}

	attempt := limiter.attempts[ip]
	attempt.count++
	attempt.expiresAt = now.Add(pinAttemptWindow)
	limiter.attempts[ip] = attempt

	if attempt.count >= maximum {
		return pinAttemptWindow
	}

	return 0
}

func (limiter *AuthLimiter) Reset(ip string) {
	limiter.mutex.Lock()
	defer limiter.mutex.Unlock()

	delete(limiter.attempts, ip)
}

func (limiter *AuthLimiter) RetryAfter(ip string, maximum uint) time.Duration {
	limiter.mutex.Lock()
	defer limiter.mutex.Unlock()

	if maximum == 0 {
		delete(limiter.attempts, ip)
		return 0
	}

	attempt, ok := limiter.attempts[ip]
	if !ok || attempt.count < maximum {
		return 0
	}

	retryAfter := time.Until(attempt.expiresAt)
	if retryAfter <= 0 {
		delete(limiter.attempts, ip)
		return 0
	}

	return retryAfter
}
