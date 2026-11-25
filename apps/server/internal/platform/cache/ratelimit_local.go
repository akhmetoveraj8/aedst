package cache

import (
	"sync"
	"time"

	"golang.org/x/time/rate"
)

// localMaxKeys bounds the memory of the in-process fallback limiter. At about 200 bytes per key the
// worst case is a few tens of MiB; idle keys are swept first, and past the cap a new key is let through
// (the API's in-flight load shedding still bounds the total).
const localMaxKeys = 200_000

// localLimiter is the per-replica limiter used while DragonflyDB is unreachable. It enforces the same
// limit per key on each replica (a cluster of N replicas admits up to N times the shared budget), which
// is far better than no limit at all and never takes the service down: it needs no network.
// golang.org/x/time/rate is the token bucket; this type only keys and bounds it.
type localLimiter struct {
	mu      sync.Mutex
	entries map[string]*localEntry
	maxKeys int
	now     func() time.Time
}

type localEntry struct {
	lim    *rate.Limiter
	limit  int
	period time.Duration
	seen   time.Time
}

func newLocalLimiter() *localLimiter {
	return &localLimiter{entries: make(map[string]*localEntry), maxKeys: localMaxKeys, now: time.Now}
}

// allowN spends n tokens (n = 0 only peeks) and reports whether the key still had them.
func (l *localLimiter) allowN(key string, limit int, period time.Duration, n int) bool {
	if limit <= 0 || period <= 0 {
		return true
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	e := l.entry(key, limit, period, now)
	if e == nil {
		return true
	}
	e.seen = now
	if n == 0 {
		return e.lim.TokensAt(now) >= 1
	}
	return e.lim.AllowN(now, n)
}

func (l *localLimiter) entry(key string, limit int, period time.Duration, now time.Time) *localEntry {
	if e, ok := l.entries[key]; ok && e.limit == limit && e.period == period {
		return e
	}
	if _, exists := l.entries[key]; !exists && len(l.entries) >= l.maxKeys {
		l.sweep(now)
		if len(l.entries) >= l.maxKeys {
			return nil
		}
	}
	e := &localEntry{lim: rate.NewLimiter(rate.Every(period/time.Duration(limit)), limit), limit: limit, period: period, seen: now}
	l.entries[key] = e
	return e
}

// sweep drops keys idle for longer than their period: their bucket is full again, so forgetting them
// loses nothing.
func (l *localLimiter) sweep(now time.Time) {
	for k, e := range l.entries {
		if now.Sub(e.seen) > e.period {
			delete(l.entries, k)
		}
	}
}
