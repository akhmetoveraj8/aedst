package cache

import (
	"testing"
	"time"
)

func TestLocalLimiter_RefillsAndBoundsMemory(t *testing.T) {
	now := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	l := newLocalLimiter()
	l.now = func() time.Time { return now }
	l.maxKeys = 2

	if !l.allowN("a", 1, time.Minute, 1) || l.allowN("a", 1, time.Minute, 1) {
		t.Fatal("budget of 1 per minute: first allowed, second denied")
	}
	if l.allowN("a", 1, time.Minute, 0) {
		t.Fatal("a peek on a spent key must report no capacity")
	}
	now = now.Add(time.Minute)
	if !l.allowN("a", 1, time.Minute, 1) {
		t.Fatal("the bucket refills after the period")
	}

	_ = l.allowN("b", 1, time.Minute, 1)
	if !l.allowN("c", 1, time.Minute, 1) || len(l.entries) != 2 {
		t.Fatalf("at the cap a new key is let through without growing the map, entries = %d", len(l.entries))
	}
	now = now.Add(2 * time.Minute)
	_ = l.allowN("c", 1, time.Minute, 1)
	if _, ok := l.entries["c"]; !ok || len(l.entries) > 2 {
		t.Fatalf("idle keys must be swept to make room, entries = %v", len(l.entries))
	}
	if !l.allowN("d", 0, time.Minute, 1) {
		t.Fatal("a zero limit means no limit")
	}
}
