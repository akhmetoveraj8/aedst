// Package retention keeps append-only tables bounded. A module (or platform
// package) declares a Policy per table — how long rows are useful and how to
// delete rows older than that — and Register turns the policies into one
// leader-elected River periodic job each. River guarantees a periodic job is
// inserted once per interval cluster-wide, so N replicas do not purge N times.
//
// Deletes run in bounded batches so a large backlog never holds a long
// transaction or a long lock; the job keeps going until a batch comes back
// short, and a failed run is simply retried at the next interval.
package retention

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/riverqueue/river"
	"github.com/riverqueue/river/rivertype"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
)

// Policy describes how one table is kept bounded.
type Policy struct {
	// Name identifies the policy in logs and metrics, e.g. "platform.idempotency_keys".
	Name string
	// Retention is how long rows are kept.
	Retention time.Duration
	// Purge deletes up to limit rows older than cutoff and returns how many it
	// deleted.
	Purge func(ctx context.Context, cutoff time.Time, limit int) (int64, error)
}

const (
	batchSize      = 5_000
	defaultEvery   = time.Hour
	workerTimeout  = 10 * time.Minute
	jobKind        = "platform.retention"
	meterName      = "github.com/aedst/server/internal/platform/retention"
	purgedCounter  = "aedst_retention_purged_total"
	purgedCounterD = "Rows deleted by retention policies."
)

// Args is the payload of a retention job.
type Args struct {
	Policy string `json:"policy" river:"unique"`
}

func (Args) Kind() string { return jobKind }

// InsertOpts dedupes a run against one that is still pending or running (a
// slow purge must not stack up), but not against completed ones, or the next
// interval's run would be suppressed until River's cleaner removed the old one.
func (Args) InsertOpts() river.InsertOpts {
	return river.InsertOpts{
		MaxAttempts: 3,
		UniqueOpts: river.UniqueOpts{
			ByArgs: true,
			ByState: []rivertype.JobState{
				rivertype.JobStateAvailable, rivertype.JobStatePending, rivertype.JobStateRunning,
				rivertype.JobStateRetryable, rivertype.JobStateScheduled,
			},
		},
	}
}

// Worker executes retention jobs.
type Worker struct {
	river.WorkerDefaults[Args]
	policies map[string]Policy
	logger   *slog.Logger
	purged   metric.Int64Counter
	now      func() time.Time
}

func (w *Worker) Timeout(*river.Job[Args]) time.Duration { return workerTimeout }

func (w *Worker) Work(ctx context.Context, job *river.Job[Args]) error {
	p, ok := w.policies[job.Args.Policy]
	if !ok {
		// A policy removed by a newer deploy while its periodic job was queued.
		return river.JobCancel(fmt.Errorf("retention: unknown policy %q", job.Args.Policy))
	}
	cutoff := w.now().Add(-p.Retention)
	var total int64
	for ctx.Err() == nil {
		n, err := p.Purge(ctx, cutoff, batchSize)
		total += n
		if err != nil {
			return fmt.Errorf("retention %s: %w", p.Name, err)
		}
		if n < batchSize {
			break
		}
	}
	if total > 0 {
		w.purged.Add(ctx, total, metric.WithAttributes(attribute.String("policy", p.Name)))
		w.logger.InfoContext(ctx, "retention: purged rows", slog.String("policy", p.Name), slog.Int64("rows", total))
	}
	return nil
}

// Register adds the retention worker to workers and returns the periodic jobs
// (one per policy) to pass to the River client's configuration. every <= 0
// means hourly.
func Register(workers *river.Workers, policies []Policy, every time.Duration, logger *slog.Logger) ([]*river.PeriodicJob, error) {
	if every <= 0 {
		every = defaultEvery
	}
	counter, err := otel.Meter(meterName).Int64Counter(purgedCounter, metric.WithDescription(purgedCounterD))
	if err != nil {
		return nil, fmt.Errorf("retention: metrics: %w", err)
	}
	w := &Worker{policies: make(map[string]Policy, len(policies)), logger: logger, purged: counter, now: time.Now}
	jobs := make([]*river.PeriodicJob, 0, len(policies))
	for _, p := range policies {
		if _, dup := w.policies[p.Name]; dup {
			return nil, fmt.Errorf("retention: duplicate policy %q", p.Name)
		}
		w.policies[p.Name] = p
		name := p.Name
		jobs = append(jobs, river.NewPeriodicJob(
			river.PeriodicInterval(every),
			func() (river.JobArgs, *river.InsertOpts) { return Args{Policy: name}, nil },
			&river.PeriodicJobOpts{ID: "retention:" + name, RunOnStart: true},
		))
	}
	if err := river.AddWorkerSafely(workers, w); err != nil {
		return nil, fmt.Errorf("retention: add worker: %w", err)
	}
	return jobs, nil
}
