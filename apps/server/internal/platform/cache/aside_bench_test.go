package cache_test

import (
	"context"
	"testing"
	"time"

	"github.com/aedst/server/internal/platform/cache"
)

func BenchmarkAsideHit(b *testing.B) {
	store, _ := newStore(b)
	a := cache.NewAside[counts](store, "bench.counts", time.Minute)
	load := func(context.Context) (counts, error) { return counts{Total: 10, Done: 4}, nil }
	ctx := b.Context()
	if _, err := a.Get(ctx, "u1", load); err != nil {
		b.Fatal(err)
	}
	b.ReportAllocs()
	for b.Loop() {
		if _, err := a.Get(ctx, "u1", load); err != nil {
			b.Fatal(err)
		}
	}
}

// BenchmarkAsideDisabled is the cost the helper adds when no cache is
// configured: it must stay at zero allocations.
func BenchmarkAsideDisabled(b *testing.B) {
	a := cache.NewAside[counts](nil, "bench.counts", time.Minute)
	load := func(context.Context) (counts, error) { return counts{Total: 10, Done: 4}, nil }
	ctx := b.Context()
	b.ReportAllocs()
	for b.Loop() {
		if _, err := a.Get(ctx, "u1", load); err != nil {
			b.Fatal(err)
		}
	}
}
