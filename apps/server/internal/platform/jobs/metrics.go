package jobs

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"

	platformdb "github.com/aedst/server/gen/db/platform"
)

// queueStates are the River job states exported as aedst_river_jobs. Completed
// jobs are left out on purpose: counting them scans the retained history.
var queueStates = []string{"available", "retryable", "scheduled", "running", "discarded"}

// snapshot is one cached read of river_job.
type snapshot struct {
	counts map[string]int64
	oldest time.Time // scheduled_at of the oldest ready job; zero if none
	at     time.Time
}

type queueCollector struct {
	pool *pgxpool.Pool
	ttl  time.Duration
	now  func() time.Time

	mu   sync.Mutex
	last snapshot
}

// RegisterMetrics exports the River queue's health as OpenTelemetry gauges,
// read from river_job with a short cache so a scrape storm costs one query:
//
//	aedst_river_jobs{state}                     jobs per state (available, retryable, scheduled, running, discarded)
//	aedst_river_oldest_available_age_seconds    age of the oldest job ready to run — the delivery lag
//
// Event deliveries are River jobs, so these replace the old outbox backlog and
// lag gauges; aedst_events_* (platform/events) adds per-consumer counters.
// Call it from one place per process, with the pool River uses.
func RegisterMetrics(pool *pgxpool.Pool) error {
	return registerMetrics(pool, 15*time.Second, time.Now)
}

func registerMetrics(pool *pgxpool.Pool, ttl time.Duration, now func() time.Time) error {
	c := &queueCollector{pool: pool, ttl: ttl, now: now}
	meter := otel.Meter("github.com/aedst/server/internal/platform/jobs")
	_, err := meter.Int64ObservableGauge("aedst_river_jobs",
		metric.WithDescription("River jobs by state (completed jobs are not counted)."),
		metric.WithInt64Callback(func(ctx context.Context, o metric.Int64Observer) error {
			s, err := c.read(ctx)
			if err != nil {
				return nil //nolint:nilerr // a metrics read must never fail collection
			}
			for _, state := range queueStates {
				o.Observe(s.counts[state], metric.WithAttributes(attribute.String("state", state)))
			}
			return nil
		}))
	if err != nil {
		return fmt.Errorf("jobs: metrics: %w", err)
	}
	_, err = meter.Float64ObservableGauge("aedst_river_oldest_available_age_seconds",
		metric.WithDescription("Age of the oldest River job that is ready to run; the job and event delivery lag."),
		metric.WithUnit("s"),
		metric.WithFloat64Callback(func(ctx context.Context, o metric.Float64Observer) error {
			s, err := c.read(ctx)
			if err != nil {
				return nil //nolint:nilerr // a metrics read must never fail collection
			}
			age := 0.0
			if !s.oldest.IsZero() {
				age = max(0, c.now().Sub(s.oldest).Seconds())
			}
			o.Observe(age)
			return nil
		}))
	if err != nil {
		return fmt.Errorf("jobs: metrics: %w", err)
	}
	return nil
}

func (c *queueCollector) read(ctx context.Context) (snapshot, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if !c.last.at.IsZero() && c.now().Sub(c.last.at) < c.ttl {
		return c.last, nil
	}
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()

	s := snapshot{counts: make(map[string]int64, len(queueStates)), at: c.now()}
	q := platformdb.New(c.pool)
	rows, err := q.CountJobsByState(ctx, queueStates)
	if err != nil {
		return c.last, fmt.Errorf("jobs: read queue state: %w", err)
	}
	for _, r := range rows {
		s.counts[r.State] = r.Jobs
	}
	oldest, err := q.OldestAvailableJobAt(ctx, pgtype.Timestamptz{Time: c.now(), Valid: true})
	if err != nil {
		return c.last, fmt.Errorf("jobs: read queue state: %w", err)
	}
	if oldest.Valid {
		s.oldest = oldest.Time
	}
	c.last = s
	return s, nil
}
