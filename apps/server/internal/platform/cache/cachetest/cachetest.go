// Package cachetest gives tests outside internal/platform/cache a working
// cache.Store without a container: an in-process miniredis behind the real
// client. Only test code imports it.
package cachetest

import (
	"testing"

	"github.com/alicebob/miniredis/v2"

	"github.com/aedst/server/internal/platform/cache"
)

// NewStore starts an in-memory server for the test and returns a Store on it,
// plus a stop function that simulates an outage.
func NewStore(t testing.TB) (store *cache.Store, stop func()) {
	t.Helper()
	mr := miniredis.RunT(t)
	client := cache.NewClient(cache.Config{Addr: mr.Addr()})
	t.Cleanup(func() { _ = client.Close() })
	return cache.NewStore(client), mr.Close
}
