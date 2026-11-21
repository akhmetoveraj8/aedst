package cache_test

import (
	"context"
	"errors"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
	"google.golang.org/protobuf/types/known/wrapperspb"

	"github.com/aedst/server/internal/platform/cache"
)

type counts struct {
	Total int
	Done  int
}

func newStore(t testing.TB) (*cache.Store, *miniredis.Miniredis) {
	t.Helper()
	mr := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: mr.Addr(), MaxRetries: -1, DialTimeout: 200 * time.Millisecond})
	t.Cleanup(func() { _ = client.Close() })
	return cache.NewStore(client), mr
}

// loader returns a load function that counts its calls.
func loader(calls *atomic.Int32, v counts, err error) func(context.Context) (counts, error) {
	return func(context.Context) (counts, error) {
		calls.Add(1)
		return v, err
	}
}

func TestAside_LoadsOnceThenServesFromCacheUntilTheTTL(t *testing.T) {
	store, mr := newStore(t)
	a := cache.NewAside[counts](store, "test.counts", time.Minute)
	var calls atomic.Int32
	want := counts{Total: 3, Done: 1}
	for range 3 {
		got, err := a.Get(t.Context(), "u1", loader(&calls, want, nil))
		if err != nil || got != want {
			t.Fatalf("Get = %+v, %v; want %+v", got, err, want)
		}
	}
	if calls.Load() != 1 {
		t.Fatalf("loader ran %d times, want 1", calls.Load())
	}
	if ttl := mr.TTL("aedst:c:test.counts:u1"); ttl <= 0 || ttl > time.Minute {
		t.Fatalf("entry TTL = %v, want (0, 1m]: every entry must expire", ttl)
	}
	mr.FastForward(time.Minute + time.Second)
	if _, err := a.Get(t.Context(), "u1", loader(&calls, want, nil)); err != nil || calls.Load() != 2 {
		t.Fatalf("after the TTL: err %v, loader ran %d times, want 2", err, calls.Load())
	}
}

func TestAside_InvalidateDropsOnlyTheNamedKeys(t *testing.T) {
	store, _ := newStore(t)
	a := cache.NewAside[counts](store, "test.counts", time.Minute)
	var calls atomic.Int32
	ctx := t.Context()
	for _, k := range []string{"u1", "u2"} {
		_, _ = a.Get(ctx, k, loader(&calls, counts{Total: 1}, nil))
	}
	if err := a.Invalidate(ctx, "u1"); err != nil {
		t.Fatal(err)
	}
	got, _ := a.Get(ctx, "u1", loader(&calls, counts{Total: 2}, nil))
	if got.Total != 2 {
		t.Fatalf("u1 after Invalidate = %+v, want the reloaded value", got)
	}
	if _, _ = a.Get(ctx, "u2", loader(&calls, counts{Total: 9}, nil)); calls.Load() != 3 {
		t.Fatalf("loader ran %d times, want 3 (u2 must still be cached)", calls.Load())
	}
}

func TestAside_InvalidateTagDropsEveryEntryUnderTheTag(t *testing.T) {
	store, _ := newStore(t)
	a := cache.NewAside[counts](store, "test.lists", time.Minute)
	var calls atomic.Int32
	ctx := t.Context()
	read := func(tag, key string) {
		t.Helper()
		if _, err := a.GetTagged(ctx, tag, key, loader(&calls, counts{}, nil)); err != nil {
			t.Fatal(err)
		}
	}
	read("u1", "page1")
	read("u1", "page2")
	read("u2", "page1")
	read("u1", "page1")
	if calls.Load() != 3 {
		t.Fatalf("loader ran %d times before invalidation, want 3", calls.Load())
	}
	if err := a.InvalidateTag(ctx, "u1"); err != nil {
		t.Fatal(err)
	}
	read("u1", "page1")
	read("u1", "page2")
	read("u2", "page1")
	if calls.Load() != 5 {
		t.Fatalf("loader ran %d times, want 5: both u1 pages reload, u2 stays cached", calls.Load())
	}
}

func TestAside_ConcurrentMissesShareOneLoad(t *testing.T) {
	store, _ := newStore(t)
	a := cache.NewAside[counts](store, "test.counts", time.Minute)
	var calls atomic.Int32
	release := make(chan struct{})
	var wg sync.WaitGroup
	for range 20 {
		wg.Go(func() {
			got, err := a.Get(t.Context(), "hot", func(context.Context) (counts, error) {
				calls.Add(1)
				<-release
				return counts{Total: 7}, nil
			})
			if err != nil || got.Total != 7 {
				t.Errorf("Get = %+v, %v", got, err)
			}
		})
	}
	for calls.Load() == 0 {
		time.Sleep(time.Millisecond)
	}
	time.Sleep(20 * time.Millisecond) // let the other callers reach the flight
	close(release)
	wg.Wait()
	if calls.Load() != 1 {
		t.Fatalf("loader ran %d times for 20 concurrent misses, want 1", calls.Load())
	}
}

func TestAside_ACancelledCallerDoesNotFailTheSharedLoad(t *testing.T) {
	store, _ := newStore(t)
	a := cache.NewAside[counts](store, "test.counts", time.Minute)
	started, release := make(chan struct{}), make(chan struct{})
	first, cancel := context.WithCancel(t.Context())
	firstErr := make(chan error, 1)
	go func() {
		_, err := a.Get(first, "k", func(ctx context.Context) (counts, error) {
			close(started)
			<-release
			return counts{Total: 1}, ctx.Err()
		})
		firstErr <- err
	}()
	<-started
	cancel()
	if err := <-firstErr; !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled caller got %v, want context.Canceled", err)
	}
	close(release)
	var calls atomic.Int32
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		calls.Store(0)
		got, err := a.Get(t.Context(), "k", loader(&calls, counts{Total: 2}, nil))
		if err == nil && got.Total == 1 {
			return // the detached load finished and its value was cached
		}
		time.Sleep(5 * time.Millisecond)
		_ = a.Invalidate(t.Context(), "k")
	}
	t.Fatal("the load started by the cancelled caller never completed")
}

func TestAside_FailsOpenWhenDragonflyIsDownOrAbsent(t *testing.T) {
	store, mr := newStore(t)
	mr.Close()
	var calls atomic.Int32
	for name, a := range map[string]*cache.Aside[counts]{
		"down":   cache.NewAside[counts](store, "test.counts", time.Minute),
		"absent": cache.NewAside[counts](nil, "test.counts", time.Minute),
	} {
		calls.Store(0)
		for range 2 {
			got, err := a.GetTagged(t.Context(), "tag", "k", loader(&calls, counts{Total: 4}, nil))
			if err != nil || got.Total != 4 {
				t.Fatalf("%s: Get = %+v, %v; an outage must only cost the load", name, got, err)
			}
		}
		if calls.Load() != 2 {
			t.Fatalf("%s: loader ran %d times, want 2 (nothing can be cached)", name, calls.Load())
		}
	}
	absent := cache.NewAside[counts](nil, "test.counts", time.Minute)
	if err := errors.Join(absent.Invalidate(t.Context(), "k"), absent.InvalidateTag(t.Context(), "tag")); err != nil {
		t.Fatalf("invalidating a disabled cache = %v, want nil", err)
	}
	down := cache.NewAside[counts](store, "test.counts", time.Minute)
	if down.Invalidate(t.Context(), "k") == nil || down.InvalidateTag(t.Context(), "tag") == nil {
		t.Fatal("an invalidation that did not reach Dragonfly must be reported")
	}
}

func TestAside_ErrorsAreNotCachedAndNotFoundOnlyWhenAsked(t *testing.T) {
	store, mr := newStore(t)
	errNotFound := errors.New("not found")
	var calls atomic.Int32
	ctx := t.Context()

	plain := cache.NewAside[counts](store, "test.plain", time.Minute)
	for range 2 {
		if _, err := plain.Get(ctx, "k", loader(&calls, counts{}, errNotFound)); !errors.Is(err, errNotFound) {
			t.Fatalf("err = %v", err)
		}
	}
	if calls.Load() != 2 {
		t.Fatalf("loader ran %d times, want 2: an error is never cached by default", calls.Load())
	}

	calls.Store(0)
	negative := cache.NewAside[counts](store, "test.negative", time.Minute, cache.WithNegative(10*time.Second, errNotFound))
	for range 3 {
		if _, err := negative.Get(ctx, "k", loader(&calls, counts{}, errNotFound)); !errors.Is(err, errNotFound) {
			t.Fatalf("err = %v, want the not-found sentinel", err)
		}
	}
	if calls.Load() != 1 {
		t.Fatalf("loader ran %d times, want 1 (tombstone)", calls.Load())
	}
	mr.FastForward(11 * time.Second)
	if _, _ = negative.Get(ctx, "k", loader(&calls, counts{}, errNotFound)); calls.Load() != 2 {
		t.Fatal("the tombstone must expire after its own TTL")
	}
	if _, err := negative.Get(ctx, "other", loader(&calls, counts{}, errors.New("boom"))); err == nil || mr.Exists("aedst:c:test.negative:other") {
		t.Fatal("an error other than not-found must not leave an entry")
	}
}

func TestAside_ProtobufValuesRoundTripAndForeignEntriesAreMisses(t *testing.T) {
	store, mr := newStore(t)
	a := cache.NewAside[*wrapperspb.StringValue](store, "test.proto", time.Minute)
	var calls atomic.Int32
	load := func(context.Context) (*wrapperspb.StringValue, error) {
		calls.Add(1)
		return wrapperspb.String("hello"), nil
	}
	for range 2 {
		got, err := a.Get(t.Context(), "k", load)
		if err != nil || got.GetValue() != "hello" {
			t.Fatalf("Get = %v, %v", got, err)
		}
	}
	if calls.Load() != 1 {
		t.Fatalf("loader ran %d times, want 1", calls.Load())
	}
	raw, _ := mr.Get("aedst:c:test.proto:k")
	if raw == "" || raw[0] != 'p' {
		t.Fatalf("stored entry %q is not marked as Protobuf", raw)
	}
	for _, foreign := range []string{"", "x-from-another-release", "j{not json"} {
		_ = mr.Set("aedst:c:test.proto:k", foreign)
		if got, err := a.Get(t.Context(), "k", load); err != nil || got.GetValue() != "hello" {
			t.Fatalf("entry %q: Get = %v, %v; an unreadable entry must fall through to the loader", foreign, got, err)
		}
	}
}

func TestAside_ALoaderPanicBecomesAnErrorNotACrash(t *testing.T) {
	store, mr := newStore(t)
	a := cache.NewAside[counts](store, "test.panic", time.Minute)
	_, err := a.Get(t.Context(), "k", func(context.Context) (counts, error) { panic("nil map write") })
	if err == nil || !strings.Contains(err.Error(), "nil map write") {
		t.Fatalf("err = %v, want the panic reported as an error", err)
	}
	if mr.Exists("aedst:c:test.panic:k") {
		t.Fatal("a panicked load must not be cached")
	}
}
