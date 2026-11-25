package cache

import (
	"context"
	"fmt"
	"time"

	"github.com/go-redis/redis_rate/v10"
	"github.com/redis/go-redis/v9"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/metric"
)

// failOpenCounter is exported as aedst_ratelimit_fail_open_total: how often a
// decision fell back to the in-process limiter because Dragonfly errored. Zero
// in a healthy system; a sustained rate means limits are enforced per replica
// instead of cluster-wide.
const failOpenCounter = "aedst_ratelimit_fail_open"

// RateLimiter is a cluster-shared GCRA rate limiter (redis_rate): every
// replica shares the same budget for a key instead of each enforcing its
// own independent limit. When Dragonfly is unreachable it degrades to an
// in-process limiter with the same limits (see localLimiter), so an outage
// never removes rate limiting and never takes the service down.
type RateLimiter struct {
	limiter  *redis_rate.Limiter
	local    *localLimiter
	failOpen metric.Int64Counter
}

// NewRateLimiter builds a RateLimiter on an existing client.
func NewRateLimiter(client *redis.Client) *RateLimiter {
	rl := &RateLimiter{limiter: redis_rate.NewLimiter(client), local: newLocalLimiter()}
	// A nil counter (instrument creation failed) only loses the metric, never a decision.
	rl.failOpen, _ = otel.Meter("github.com/aedst/server/internal/platform/cache").Int64Counter(failOpenCounter,
		metric.WithDescription("Rate-limit decisions taken by the in-process fallback because Dragonfly returned an error."))
	return rl
}

// Allow reports whether one more request is permitted for key under
// limit-per-period. On a Dragonfly error it returns the decision of the
// in-process fallback limiter together with the error (callers log it and
// still honour the decision): the service keeps working and keeps limiting.
func (l *RateLimiter) Allow(ctx context.Context, key string, limit int, period time.Duration) (bool, error) {
	res, err := l.limiter.Allow(ctx, key, redis_rate.Limit{Rate: limit, Burst: limit, Period: period})
	if err != nil {
		l.recordFailOpen(ctx)
		return l.local.allowN(key, limit, period, 1), fmt.Errorf("cache: rate limit %s (local fallback): %w", key, err)
	}
	return res.Allowed > 0, nil
}

// Exhausted reports, without consuming budget, whether key has no capacity
// left under limit-per-period. On a Dragonfly error it answers from the
// in-process fallback like Allow, together with the error.
// It lets a caller refuse work up front for a key that only spends budget on
// failure (see the failed-authentication throttle).
func (l *RateLimiter) Exhausted(ctx context.Context, key string, limit int, period time.Duration) (bool, error) {
	res, err := l.limiter.AllowN(ctx, key, redis_rate.Limit{Rate: limit, Burst: limit, Period: period}, 0)
	if err != nil {
		l.recordFailOpen(ctx)
		return !l.local.allowN(key, limit, period, 0), fmt.Errorf("cache: rate limit %s (local fallback): %w", key, err)
	}
	return res.Remaining <= 0, nil
}

func (l *RateLimiter) recordFailOpen(ctx context.Context) {
	if l.failOpen != nil {
		l.failOpen.Add(ctx, 1)
	}
}
