// Package resilience wraps an outbound http.RoundTripper with a circuit
// breaker, a rate limiter and a default timeout, for calls this server makes
// to an external service over the network (push providers today; a Connect client to an
// extracted module later).
package resilience

import (
	"context"
	"io"
	"net/http"
	"time"

	"github.com/sony/gobreaker/v2"
	"golang.org/x/time/rate"
)

// Config tunes the breaker, limiter and timeout for one outbound dependency.
type Config struct {
	// BreakerName identifies the dependency in logs/metrics, e.g. the target
	// module or service name.
	BreakerName string
	// Timeout is the deadline applied when the caller's context has none.
	Timeout time.Duration
	// MaxRequests is how many requests are allowed through while the
	// breaker is half-open, probing whether the dependency has recovered.
	MaxRequests uint32
	// RateLimitRPS caps outbound request rate to this dependency.
	RateLimitRPS float64
}

type resilientRoundTripper struct {
	next    http.RoundTripper
	limiter *rate.Limiter
	breaker *gobreaker.CircuitBreaker[*http.Response]
	timeout time.Duration
}

// WrapRoundTripper returns an http.RoundTripper that applies, in order: a
// deadline (only if the request's context has none), a token-bucket rate
// limit, then a circuit breaker around the underlying round trip.
//
// The breaker only trips on transport-level failures (dial/refused/timeout —
// anything RoundTrip itself returns as an error), not on a well-formed
// HTTP/Connect error response: a 5xx is a valid, already-classified answer
// from a reachable dependency, not evidence it's down. Tripping on 5xx too
// is a reasonable future extension if a dependency's failure mode turns out
// to be "responds slowly with 503" rather than "stops responding".
func WrapRoundTripper(next http.RoundTripper, cfg Config) http.RoundTripper {
	burst := int(cfg.RateLimitRPS)
	if burst < 1 {
		burst = 1
	}

	return &resilientRoundTripper{
		next:    next,
		limiter: rate.NewLimiter(rate.Limit(cfg.RateLimitRPS), burst),
		breaker: gobreaker.NewCircuitBreaker[*http.Response](gobreaker.Settings{
			Name:        cfg.BreakerName,
			MaxRequests: cfg.MaxRequests,
			IsSuccessful: func(err error) bool {
				return err == nil
			},
		}),
		timeout: cfg.Timeout,
	}
}

func (rt *resilientRoundTripper) RoundTrip(req *http.Request) (*http.Response, error) {
	ctx := req.Context()
	cancel := func() {}
	if _, hasDeadline := ctx.Deadline(); !hasDeadline && rt.timeout > 0 {
		ctx, cancel = context.WithTimeout(ctx, rt.timeout)
		req = req.WithContext(ctx)
	}

	if err := rt.limiter.Wait(ctx); err != nil {
		cancel()
		return nil, err
	}

	resp, err := rt.breaker.Execute(func() (*http.Response, error) {
		return rt.next.RoundTrip(req)
	})
	if err != nil || resp == nil {
		cancel()
		return resp, err
	}
	// The deadline must outlive this call: the caller reads the body after
	// RoundTrip returns, so the context is released when the body is closed,
	// not here (cancelling on return would truncate every response).
	resp.Body = &cancelOnClose{ReadCloser: resp.Body, cancel: cancel}
	return resp, nil
}

type cancelOnClose struct {
	io.ReadCloser
	cancel context.CancelFunc
}

func (c *cancelOnClose) Close() error {
	err := c.ReadCloser.Close()
	c.cancel()
	return err
}
