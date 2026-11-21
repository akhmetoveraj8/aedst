package cache

import (
	"context"
	"errors"
	"fmt"
	"runtime/debug"
	"time"

	"golang.org/x/sync/singleflight"
)

const (
	// maxEntryBytes: larger values are served but not cached (a cache entry is
	// a small read model, not a blob).
	maxEntryBytes = 1 << 20
	// defaultLoadTimeout bounds a shared load once its first caller has gone.
	defaultLoadTimeout = 10 * time.Second
)

// Aside is a typed cache-aside (get-or-load) helper for one kind of value.
//
// Rules (docs/content/engineering/performance.md, apps/server/AGENTS.md):
//   - the cache never holds correctness: every entry has a TTL and the loader
//     is the source of truth; a Dragonfly error, timeout or nil Store means the
//     loader runs (fail open) and the result is simply not cached;
//   - invalidate explicitly in the write path (Invalidate / InvalidateTag) after
//     the write commits; the TTL bounds the staleness a racing read can leave;
//   - never cache an authorization decision for longer than a token lives.
//
// Values are stored as Protobuf when T is a generated message and as JSON
// otherwise. Concurrent misses for one key share a single load (singleflight),
// so an expired hot key costs one query per process, not one per request. The
// callers of a shared load receive the same value: treat a returned pointer,
// slice or map as read-only.
type Aside[T any] struct {
	store       *Store
	name        string
	ttl         time.Duration
	negativeTTL time.Duration
	notFound    error
	loadTimeout time.Duration
	flight      singleflight.Group
}

// Option configures an Aside.
type Option func(*options)

type options struct {
	negativeTTL time.Duration
	notFound    error
}

// WithNegative caches "does not exist" for ttl: when the loader's error matches
// notFound (errors.Is), a tombstone is stored and later lookups return notFound
// itself without loading. Use it only where a missing row is asked for often.
func WithNegative(ttl time.Duration, notFound error) Option {
	return func(o *options) { o.negativeTTL, o.notFound = ttl, notFound }
}

// NewAside builds the helper. name namespaces the keys and labels the metrics
// ("<module>.<what>", e.g. "tasks.stats"); it must be unique per value type.
// store may be nil (cache disabled).
func NewAside[T any](store *Store, name string, ttl time.Duration, opts ...Option) *Aside[T] {
	var o options
	for _, opt := range opts {
		opt(&o)
	}
	return &Aside[T]{store: store, name: name, ttl: ttl, negativeTTL: o.negativeTTL, notFound: o.notFound, loadTimeout: defaultLoadTimeout}
}

// Get returns the cached value for key, or loads, caches and returns it.
func (a *Aside[T]) Get(ctx context.Context, key string, load func(context.Context) (T, error)) (T, error) {
	return a.GetTagged(ctx, "", key, load)
}

// GetTagged is Get for an entry that belongs to tag (for example one owner's
// lists): InvalidateTag(tag) drops every entry read under it at once. It costs
// one extra round trip for the tag's version.
func (a *Aside[T]) GetTagged(ctx context.Context, tag, key string, load func(context.Context) (T, error)) (T, error) {
	if a.store == nil {
		return load(ctx)
	}
	full, ok := a.fullKey(ctx, tag, key)
	if ok {
		if v, hit, err := a.lookup(ctx, full); hit {
			return v, err
		}
	}
	// The shared load must not die with its first caller: it runs detached
	// (trace and values kept) under its own deadline, and every caller waits
	// on its own context.
	ch := a.flight.DoChan(full, func() (res any, err error) {
		// The load runs on a goroutine of its own, where a panic would end the
		// process instead of one request: hand it to the callers as an error.
		defer func() {
			if r := recover(); r != nil {
				res, err = nil, fmt.Errorf("cache: %s: loader panicked: %v\n%s", a.name, r, debug.Stack())
			}
		}()
		loadCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), a.loadTimeout)
		defer cancel()
		v, err := load(loadCtx)
		if ok {
			a.remember(loadCtx, full, v, err)
		}
		return v, err
	})
	select {
	case <-ctx.Done():
		var zero T
		return zero, fmt.Errorf("cache: %s: waiting for the load: %w", a.name, ctx.Err())
	case res := <-ch:
		v, _ := res.Val.(T)
		return v, res.Err
	}
}

// Invalidate drops the entries for keys. Call it after the write committed. A
// failure is returned for logging only: the TTL still expires the entries.
func (a *Aside[T]) Invalidate(ctx context.Context, keys ...string) error {
	if a.store == nil || len(keys) == 0 {
		return nil
	}
	full := make([]string, len(keys))
	for i, k := range keys {
		full[i] = keyPrefix + a.name + ":" + k
	}
	if err := a.store.del(ctx, full...); err != nil {
		a.store.countFailOpen(ctx, a.name, "invalidate")
		return err
	}
	return nil
}

// InvalidateTag drops every entry read through GetTagged with tag, in O(1): it
// moves the tag to a new version, and entries under the old one expire by TTL.
func (a *Aside[T]) InvalidateTag(ctx context.Context, tag string) error {
	if a.store == nil {
		return nil
	}
	// The version must outlive every entry written under an earlier one.
	if err := a.store.bump(ctx, a.tagKey(tag), 2*max(a.ttl, a.negativeTTL)+time.Minute); err != nil {
		a.store.countFailOpen(ctx, a.name, "invalidate_tag")
		return err
	}
	return nil
}

func (a *Aside[T]) tagKey(tag string) string { return keyPrefix + a.name + ":tag:" + tag }

// fullKey resolves the stored key. ok is false when the tag version could not
// be read: the caller then loads without touching the cache.
func (a *Aside[T]) fullKey(ctx context.Context, tag, key string) (string, bool) {
	if tag == "" {
		return keyPrefix + a.name + ":" + key, true
	}
	version := "0"
	raw, err := a.store.get(ctx, a.tagKey(tag))
	switch {
	case err == nil:
		version = string(raw)
	case !errors.Is(err, errMiss):
		a.store.countFailOpen(ctx, a.name, "get")
		a.store.countRequest(ctx, a.name, "error")
		return keyPrefix + a.name + ":" + tag + "@?:" + key, false
	}
	return keyPrefix + a.name + ":" + tag + "@" + version + ":" + key, true
}

// lookup reads one entry. hit is false on a miss, an error or an entry this
// release cannot read; all three fall through to the loader.
func (a *Aside[T]) lookup(ctx context.Context, full string) (v T, hit bool, err error) {
	raw, err := a.store.get(ctx, full)
	if errors.Is(err, errMiss) {
		a.store.countRequest(ctx, a.name, "miss")
		return v, false, nil
	}
	if err != nil {
		a.store.countFailOpen(ctx, a.name, "get")
		a.store.countRequest(ctx, a.name, "error")
		return v, false, nil //nolint:nilerr // fail open: a cache error is a miss (counted above), the loader answers
	}
	v, negative, err := decode[T](raw)
	if err != nil || (negative && a.notFound == nil) {
		a.store.countRequest(ctx, a.name, "miss")
		var zero T
		return zero, false, nil //nolint:nilerr // an entry this release cannot read is a miss, the loader answers
	}
	if negative {
		a.store.countRequest(ctx, a.name, "negative_hit")
		return v, true, a.notFound
	}
	a.store.countRequest(ctx, a.name, "hit")
	return v, true, nil
}

// remember stores the outcome of a load: the value, or a tombstone for a
// configured not-found. Any other error is never cached.
func (a *Aside[T]) remember(ctx context.Context, full string, v T, loadErr error) {
	var (
		raw []byte
		ttl = a.ttl
	)
	switch {
	case loadErr == nil:
		var err error
		if raw, err = encode(v); err != nil || len(raw) > maxEntryBytes {
			return
		}
	case a.notFound != nil && errors.Is(loadErr, a.notFound):
		raw, ttl = []byte{markNegative}, a.negativeTTL
	default:
		return
	}
	if err := a.store.set(ctx, full, raw, ttl); err != nil {
		a.store.countFailOpen(ctx, a.name, "set")
	}
}
