package valkey

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
// limiter decision was skipped because Valkey errored. Zero in a healthy
// system; a sustained rate means rate limits are not being enforced.
const failOpenCounter = "aedst_ratelimit_fail_open"

// RateLimiter is a cluster-shared GCRA rate limiter (redis_rate): every
// replica shares the same budget for a key instead of each enforcing its
// own independent limit.
type RateLimiter struct {
	limiter  *redis_rate.Limiter
	failOpen metric.Int64Counter
}

// NewRateLimiter builds a RateLimiter on an existing client.
func NewRateLimiter(client *redis.Client) *RateLimiter {
	rl := &RateLimiter{limiter: redis_rate.NewLimiter(client)}
	// A nil counter (instrument creation failed) only loses the metric, never a decision.
	rl.failOpen, _ = otel.Meter("github.com/aedst/server/internal/platform/valkey").Int64Counter(failOpenCounter,
		metric.WithDescription("Rate-limit decisions skipped (allowed) because Valkey returned an error."))
	return rl
}

// Allow reports whether one more request is permitted for key under
// limit-per-period. It fails open: on a Valkey error it returns true with the
// error, because a limiter that takes the service down when its backing
// store is unavailable is worse than briefly not limiting. Callers should
// log the error.
func (l *RateLimiter) Allow(ctx context.Context, key string, limit int, period time.Duration) (bool, error) {
	res, err := l.limiter.Allow(ctx, key, redis_rate.Limit{Rate: limit, Burst: limit, Period: period})
	if err != nil {
		l.recordFailOpen(ctx)
		return true, fmt.Errorf("valkey: rate limit %s: %w", key, err)
	}
	return res.Allowed > 0, nil
}

// Exhausted reports, without consuming budget, whether key has no capacity
// left under limit-per-period. It fails open like Allow (false with the error).
// It lets a caller refuse work up front for a key that only spends budget on
// failure (see the failed-authentication throttle).
func (l *RateLimiter) Exhausted(ctx context.Context, key string, limit int, period time.Duration) (bool, error) {
	res, err := l.limiter.AllowN(ctx, key, redis_rate.Limit{Rate: limit, Burst: limit, Period: period}, 0)
	if err != nil {
		l.recordFailOpen(ctx)
		return false, fmt.Errorf("valkey: rate limit %s: %w", key, err)
	}
	return res.Remaining <= 0, nil
}

func (l *RateLimiter) recordFailOpen(ctx context.Context) {
	if l.failOpen != nil {
		l.failOpen.Add(ctx, 1)
	}
}
