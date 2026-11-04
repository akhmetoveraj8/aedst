package valkey_test

import (
	"context"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"

	"github.com/aedst/server/internal/platform/valkey"
)

func newLimiter(t *testing.T) (*valkey.RateLimiter, *miniredis.Miniredis) {
	t.Helper()
	mr := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: mr.Addr(), MaxRetries: -1, DialTimeout: 200 * time.Millisecond})
	t.Cleanup(func() { _ = client.Close() })
	return valkey.NewRateLimiter(client), mr
}

func TestRateLimiter_AllowsUpToTheBudgetThenDenies(t *testing.T) {
	l, _ := newLimiter(t)
	ctx := context.Background()
	for i := range 3 {
		ok, err := l.Allow(ctx, "rl:user:a", 3, time.Minute)
		if err != nil || !ok {
			t.Fatalf("request %d = %v, %v; want allowed", i+1, ok, err)
		}
	}
	if ok, err := l.Allow(ctx, "rl:user:a", 3, time.Minute); err != nil || ok {
		t.Fatalf("request 4 = %v, %v; want denied", ok, err)
	}
}

func TestRateLimiter_KeysAreIndependent(t *testing.T) {
	l, _ := newLimiter(t)
	ctx := context.Background()
	for range 2 {
		_, _ = l.Allow(ctx, "rl:user:a", 2, time.Minute)
	}
	if ok, _ := l.Allow(ctx, "rl:user:a", 2, time.Minute); ok {
		t.Fatal("user a must be limited")
	}
	if ok, err := l.Allow(ctx, "rl:user:b", 2, time.Minute); err != nil || !ok {
		t.Fatalf("user b = %v, %v; another key's budget must not be shared", ok, err)
	}
}

func TestRateLimiter_FailsOpenWhenValkeyIsDown(t *testing.T) {
	l, mr := newLimiter(t)
	mr.Close()
	ok, err := l.Allow(context.Background(), "rl:user:a", 1, time.Minute)
	if !ok {
		t.Fatal("a limiter outage must let requests through")
	}
	if err == nil {
		t.Fatal("the outage must be reported to the caller (it logs and counts it)")
	}
	exhausted, err := l.Exhausted(context.Background(), "rl:authfail:1.2.3.4", 1, time.Minute)
	if exhausted || err == nil {
		t.Fatalf("Exhausted during an outage = %v, %v; want false with an error", exhausted, err)
	}
}

func TestRateLimiter_ExhaustedPeeksWithoutSpending(t *testing.T) {
	l, _ := newLimiter(t)
	ctx := context.Background()
	for range 5 { // peeking is free: the budget never drains
		if ex, err := l.Exhausted(ctx, "rl:authfail:1.2.3.4", 2, time.Minute); err != nil || ex {
			t.Fatalf("fresh key Exhausted = %v, %v", ex, err)
		}
	}
	_, _ = l.Allow(ctx, "rl:authfail:1.2.3.4", 2, time.Minute)
	_, _ = l.Allow(ctx, "rl:authfail:1.2.3.4", 2, time.Minute)
	if ex, err := l.Exhausted(ctx, "rl:authfail:1.2.3.4", 2, time.Minute); err != nil || !ex {
		t.Fatalf("after the budget is spent Exhausted = %v, %v; want true", ex, err)
	}
}
