package main

import "testing"

func TestClientsTryReserveIncludesUnauthenticatedConnections(t *testing.T) {
	clients := NewClients()

	if !clients.TryReserve(1) {
		t.Fatal("first connection reservation was rejected")
	}
	if clients.TryReserve(1) {
		t.Fatal("connection above the configured maximum was accepted")
	}

	clients.Release()
	if !clients.TryReserve(1) {
		t.Fatal("reservation was not released after disconnect")
	}
}

func TestClientsTryReserveRejectsZeroLimit(t *testing.T) {
	if NewClients().TryReserve(0) {
		t.Fatal("connection was accepted with a zero client limit")
	}
}
