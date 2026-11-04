package httpserver

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"slices"
	"sync"
	"sync/atomic"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
	"golang.org/x/sync/singleflight"
)

// Check is one named dependency probe used by /readyz.
type Check struct {
	Name string
	Fn   func(ctx context.Context) error
	// Optional marks a dependency the service degrades without instead of
	// failing (e.g. a cache or a fail-open rate limiter): a failing optional
	// check is reported under "degraded" but does not take the instance out of
	// rotation. Only checks that make correct answers impossible (the primary
	// database) should be required — otherwise a cache outage becomes a total
	// outage on every replica at once.
	Optional bool
}

// Readiness answers /readyz. It reports not-ready while any required
// dependency check fails or once SetDraining was called (graceful shutdown),
// which lets a load balancer stop routing before the listener closes.
type Readiness struct {
	checks   []Check
	draining atomic.Bool

	// Probes arrive from every kubelet, load balancer and scrape: one evaluation
	// is shared by concurrent callers (singleflight) and reused for
	// readinessCacheTTL, so /readyz cannot multiply load on the database.
	flight singleflight.Group
	mu     sync.Mutex
	last   readinessResult
	lastAt time.Time
	now    func() time.Time
	ttl    time.Duration
}

func NewReadiness(checks ...Check) *Readiness {
	return &Readiness{checks: checks, now: time.Now, ttl: readinessCacheTTL}
}

// SetDraining flips /readyz to 503 permanently; call at the start of shutdown.
func (r *Readiness) SetDraining() { r.draining.Store(true) }

// Draining reports whether SetDraining was called.
func (r *Readiness) Draining() bool { return r != nil && r.draining.Load() }

const readinessCheckTimeout = 2 * time.Second

// Evaluate runs every check (concurrently, so probe latency is the slowest
// dependency rather than their sum) and returns the names of failed required
// and failed optional checks.
func (r *Readiness) Evaluate(ctx context.Context) (failed, degraded []string) {
	if r == nil {
		return nil, nil
	}
	ctx, cancel := context.WithTimeout(ctx, readinessCheckTimeout)
	defer cancel()

	errs := make([]error, len(r.checks))
	done := make(chan struct{}, len(r.checks))
	for i, c := range r.checks {
		go func() {
			errs[i] = c.Fn(ctx)
			done <- struct{}{}
		}()
	}
	for range r.checks {
		<-done
	}
	for i, c := range r.checks {
		if errs[i] == nil {
			continue
		}
		if c.Optional {
			degraded = append(degraded, c.Name) // names only: never leak error detail to callers
		} else {
			failed = append(failed, c.Name)
		}
	}
	return failed, degraded
}

// Handler returns the /readyz handler. A nil Readiness is always ready.
func (r *Readiness) Handler() http.HandlerFunc {
	return func(w http.ResponseWriter, req *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r == nil {
			_, _ = w.Write([]byte(`{"status":"ok"}`))
			return
		}
		if r.Draining() {
			w.WriteHeader(http.StatusServiceUnavailable)
			_, _ = w.Write([]byte(`{"status":"draining"}`))
			return
		}

		failed, degraded := r.evaluateShared(req.Context())
		body := map[string]any{"status": "ok"}
		switch {
		case len(failed) > 0:
			w.WriteHeader(http.StatusServiceUnavailable)
			body = map[string]any{"status": "unavailable", "failed": failed}
		case len(degraded) > 0:
			body = map[string]any{"status": "degraded", "degraded": degraded}
		}
		_ = json.NewEncoder(w).Encode(body)
	}
}

// readinessCacheTTL is how long an evaluation is reused. Shorter than the
// fastest probe period (kubelet readiness: 5 s) so state changes are seen
// promptly, longer than a burst of concurrent probes.
const readinessCacheTTL = 1500 * time.Millisecond

type readinessResult struct{ failed, degraded []string }

// evaluateShared returns a recent evaluation, running at most one at a time.
// The probe runs on a context detached from any one caller, so a caller that
// gives up cannot fail the evaluation everyone else is waiting for.
func (r *Readiness) evaluateShared(ctx context.Context) (failed, degraded []string) {
	if r == nil {
		return nil, nil
	}
	r.mu.Lock()
	if r.ttl > 0 && !r.lastAt.IsZero() && r.now().Sub(r.lastAt) < r.ttl {
		res := r.last
		r.mu.Unlock()
		return res.failed, res.degraded
	}
	r.mu.Unlock()

	v, _, _ := r.flight.Do("evaluate", func() (any, error) {
		f, d := r.Evaluate(context.WithoutCancel(ctx))
		res := readinessResult{failed: f, degraded: d}
		r.mu.Lock()
		r.last, r.lastAt = res, r.now()
		r.mu.Unlock()
		return res, nil
	})
	res, _ := v.(readinessResult)
	return res.failed, res.degraded
}

// WithCacheTTL sets how long an evaluation is reused (0 = never; concurrent
// probes are still coalesced). The default is readinessCacheTTL.
func (r *Readiness) WithCacheTTL(d time.Duration) *Readiness {
	r.ttl = d
	return r
}

// RegisterMetrics exports aedst_readiness_degraded{check}: 1 while an optional
// dependency (Valkey, the read replica) fails its probe, 0 while it passes. A
// degraded instance still serves (that is the point of Optional), so without
// this gauge a Valkey outage, which switches every rate limit off, is invisible
// to alerting. The callback reads the shared evaluation, so a scrape costs no
// extra probes.
func (r *Readiness) RegisterMetrics() error {
	meter := otel.Meter("github.com/aedst/server/internal/platform/httpserver")
	_, err := meter.Int64ObservableGauge("aedst_readiness_degraded",
		metric.WithDescription("1 while an optional dependency check fails (the instance serves in degraded mode), per check."),
		metric.WithInt64Callback(func(ctx context.Context, o metric.Int64Observer) error {
			_, degraded := r.evaluateShared(ctx)
			for _, c := range r.checks {
				if !c.Optional {
					continue
				}
				v := int64(0)
				if slices.Contains(degraded, c.Name) {
					v = 1
				}
				o.Observe(v, metric.WithAttributes(attribute.String("check", c.Name)))
			}
			return nil
		}))
	if err != nil {
		return fmt.Errorf("httpserver: register readiness metric: %w", err)
	}
	return nil
}
