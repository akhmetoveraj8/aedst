package httpserver

import (
	"context"
	"time"
)

// FailureLimiter is the limiter behind the failed-authentication throttle:
// Allow spends one unit of budget, Exhausted peeks without spending. It is
// satisfied by cache.RateLimiter.
type FailureLimiter interface {
	RateLimiter
	Exhausted(ctx context.Context, key string, limit int, period time.Duration) (bool, error)
}

// authFailWindow is the period of the per-address failure budget.
const authFailWindow = time.Minute

// AuthOption configures AuthInterceptor.
type AuthOption func(*authConfig)

type authConfig struct {
	limiter   FailureLimiter
	perMinute int
	warn      func(ctx context.Context, err error)
}

// WithFailureThrottle limits failed authentications per client address,
// cluster-wide: every missing or invalid token spends one unit of the address's
// budget (key rl:authfail:<ip>), and once perMinute failures have happened a
// further request from that address is refused with RESOURCE_EXHAUSTED before
// its token is even looked at. Successful requests spend nothing. During a
// limiter outage the budget is kept per replica (cache.RateLimiter's
// in-process fallback): like every limiter here it must not become a second
// way to take the API down. perMinute <= 0
// disables it.
func WithFailureThrottle(limiter FailureLimiter, perMinute int) AuthOption {
	return func(c *authConfig) { c.limiter, c.perMinute = limiter, perMinute }
}

// failureThrottle is the per-request side of WithFailureThrottle; the zero
// value (no limiter) does nothing.
type failureThrottle struct{ authConfig }

func (t failureThrottle) enabled() bool { return t.limiter != nil && t.perMinute > 0 }

func (t failureThrottle) key(ctx context.Context) string {
	return "rl:authfail:" + clientAddr(ctx)
}

// refuse returns the error to send when the address has used up its failure
// budget, or nil.
func (t failureThrottle) refuse(ctx context.Context) error {
	if !t.enabled() {
		return nil
	}
	exhausted, err := t.limiter.Exhausted(ctx, t.key(ctx), t.perMinute, authFailWindow)
	if err != nil {
		t.warn(ctx, err) // degraded: the answer came from the in-process fallback
	}
	if !exhausted {
		return nil
	}
	return rateLimited(ctx, "too many failed authentication attempts, try again later", "60")
}

// record spends one unit of the address's failure budget.
func (t failureThrottle) record(ctx context.Context) {
	if !t.enabled() {
		return
	}
	if _, err := t.limiter.Allow(ctx, t.key(ctx), t.perMinute, authFailWindow); err != nil {
		t.warn(ctx, err)
	}
}
