// Package jobs wires River for background job processing (email, push
// notifications, media processing, search indexing, cleanup, scheduled
// tasks — see docs/content/decisions/0005-river-for-jobs.md). Modules register their
// own job kinds/workers here at startup; this package only owns the River
// client lifecycle, not any job's business logic.
package jobs

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/riverdriver/riverpgxv5"
	"github.com/riverqueue/river/rivermigrate"
	"github.com/riverqueue/river/rivertype"
	"github.com/riverqueue/rivercontrib/otelriver"

	platformdb "github.com/aedst/server/gen/db/platform"
)

// Client is the River client type every module's job-enqueuing code depends
// on, parameterized over pgx's transaction type.
type Client = river.Client[pgx.Tx]

// NewClient builds a River client bound to the shared Postgres pool, using
// workers registered by every module (via workers.AddWorker in cmd/server's
// wiring) so a job enqueued in the same transaction as the state change that
// triggers it (see ADR-0005) shares that module's connection pool.
func NewClient(pool *pgxpool.Pool, workers *river.Workers, logger *slog.Logger, periodic ...*river.PeriodicJob) (*Client, error) {
	return NewClientWithQueues(pool, workers, logger, map[string]int{river.QueueDefault: 10}, periodic...)
}

// QueueMedia is the queue of heavy media processing jobs (image variants,
// ffmpeg). It is separate so a dedicated worker deployment can run only it
// (AEDST_JOBS_QUEUES=media) while API replicas run the light queues.
const QueueMedia = "media"

// MaxJobTimeout is the longest Timeout any worker declares (media processing).
// RescueStuckJobsAfter must stay above it, plus a margin, see RescueAfter.
const MaxJobTimeout = 10 * time.Minute

// RescueAfter is the RescueStuckJobsAfter value for a process whose longest
// worker runs maxTimeout: the timeout plus a margin for the cancel-and-record
// path, so a still-running healthy job is never rescued (run twice).
func RescueAfter(maxTimeout time.Duration) time.Duration { return maxTimeout + 5*time.Minute }

// SoftStopFor derives SoftStopTimeout from the shutdown budget: the budget minus
// a margin (at least one second), so jobs cancelled at the soft limit still get
// time to persist their state before the process is killed.
func SoftStopFor(shutdown time.Duration) time.Duration {
	const margin = 2 * time.Second
	if shutdown <= margin {
		return time.Second
	}
	return shutdown - margin
}

// NewClientWithQueues is NewClient with an explicit set of queues this process
// works (queue name -> max concurrent workers). An empty map makes the client
// insert-only: it can enqueue jobs inside transactions but never runs any,
// which is what an API-only replica wants when workers are deployed apart.
func NewClientWithQueues(pool *pgxpool.Pool, workers *river.Workers, logger *slog.Logger, queues map[string]int, periodic ...*river.PeriodicJob) (*Client, error) {
	return NewClientWithOptions(pool, workers, logger, Options{Queues: queues}, periodic...)
}

// Options are the River client settings beyond the pool and workers.
type Options struct {
	// Queues maps queue name -> max concurrent workers; empty = insert-only.
	Queues map[string]int
	// PollOnly disables LISTEN/NOTIFY (river.Config.PollOnly): job pickup and
	// leader election poll instead. Needed when the pool sits behind a
	// transaction pooler (PgBouncer) and no direct connection is available.
	PollOnly bool
	// CompletedRetention, CancelledRetention and DiscardedRetention are how
	// long River keeps finished jobs before its cleaner deletes them (zero =
	// River's defaults: 24h, 24h, 7d). Event deliveries are River jobs, so
	// these replace the old outbox/inbox purge: completed deliveries only
	// need to outlive the unique-by-(consumer,event) window, and discarded
	// ones are the dead-letter list operators inspect and replay.
	CompletedRetention time.Duration
	CancelledRetention time.Duration
	DiscardedRetention time.Duration
	// SoftStopTimeout is how long Stop waits for running jobs before cancelling
	// their contexts. Keep it below the process shutdown budget
	// (AEDST_SHUTDOWN_TIMEOUT_SECONDS) so the cancelled jobs can still record their
	// state before the pod is killed; zero = wait for the Stop context only.
	SoftStopTimeout time.Duration
	// RescueStuckJobsAfter is how long a job may stay "running" before River
	// assumes its process died and retries it. It must exceed the longest worker
	// Timeout (MaxJobTimeout) or healthy long jobs are run twice; zero = River's
	// default (1h).
	RescueStuckJobsAfter time.Duration
}

// NewClientWithOptions is NewClientWithQueues with the full option set.
func NewClientWithOptions(pool *pgxpool.Pool, workers *river.Workers, logger *slog.Logger, opts Options, periodic ...*river.PeriodicJob) (*Client, error) {
	queues := opts.Queues
	cfg := &river.Config{
		Logger:   logger,
		Workers:  workers,
		PollOnly: opts.PollOnly,

		CompletedJobRetentionPeriod: opts.CompletedRetention,
		CancelledJobRetentionPeriod: opts.CancelledRetention,
		DiscardedJobRetentionPeriod: opts.DiscardedRetention,
		// Traces and metrics per job; EnableTracePropagation carries the enqueuing
		// request's trace context in the job metadata, so a job's work span links
		// back to the request that created it, for every job kind.
		Middleware: []rivertype.Middleware{otelriver.NewMiddleware(&otelriver.MiddlewareConfig{
			EnableTracePropagation:      true,
			EnableWorkSpanJobKindSuffix: true,
		})},
		SoftStopTimeout:      opts.SoftStopTimeout,
		RescueStuckJobsAfter: opts.RescueStuckJobsAfter,
	}
	if len(queues) > 0 {
		cfg.Queues = make(map[string]river.QueueConfig, len(queues))
		for name, n := range queues {
			cfg.Queues[name] = river.QueueConfig{MaxWorkers: n}
		}
		cfg.PeriodicJobs = periodic
	}
	client, err := river.NewClient(riverpgxv5.New(pool), cfg)
	if err != nil {
		return nil, fmt.Errorf("jobs: new river client: %w", err)
	}
	return client, nil
}

// Works reports whether client runs jobs (has queues) rather than only
// inserting them.
func Works(queues map[string]int) bool { return len(queues) > 0 }

// PendingCount is the number of jobs waiting to run or to be retried, across
// all queues (operator dashboards, see the admin module).
func PendingCount(ctx context.Context, pool *pgxpool.Pool) (int64, error) {
	n, err := platformdb.New(pool).CountPendingJobs(ctx)
	if err != nil {
		return 0, fmt.Errorf("jobs: pending count: %w", err)
	}
	return n, nil
}

// OldestAvailableAge is how long the oldest job that is ready to run has been
// waiting (event deliveries included): the delivery lag of the River-backed
// outbox. Zero when nothing is waiting. It is one probe of the fetch index.
func OldestAvailableAge(ctx context.Context, pool *pgxpool.Pool, now time.Time) (time.Duration, error) {
	oldest, err := platformdb.New(pool).OldestAvailableJobAt(ctx, pgtype.Timestamptz{Time: now, Valid: true})
	if err != nil {
		return 0, fmt.Errorf("jobs: oldest available: %w", err)
	}
	if !oldest.Valid || now.Before(oldest.Time) {
		return 0, nil
	}
	return now.Sub(oldest.Time), nil
}

// Migrate applies River's own schema migrations (the river_job/river_leader
// tables etc., see ADR-0005) against the shared Postgres pool. It uses
// River's bundled Go migrator rather than a hand-copied goose SQL file under
// migrations/ so the schema stays byte-for-byte in sync with the installed
// River version; it's idempotent (safe to call on every startup) since the
// migrator tracks applied versions itself in river_migration.
func Migrate(ctx context.Context, pool *pgxpool.Pool) error {
	migrator, err := rivermigrate.New(riverpgxv5.New(pool), nil)
	if err != nil {
		return fmt.Errorf("jobs: new migrator: %w", err)
	}
	if _, err := migrator.Migrate(ctx, rivermigrate.DirectionUp, nil); err != nil {
		return fmt.Errorf("jobs: migrate up: %w", err)
	}
	return nil
}

// ErrSchemaNotMigrated means River's tables are missing or behind this binary.
var ErrSchemaNotMigrated = errors.New("jobs: river schema is not migrated")

// Verify checks, without changing anything, that River's schema is at the
// version this binary expects. Deployed environments call it at startup: River's
// migrations run once per release in the migration Job (river migrate-up from
// the migrate image), never from every replica racing at boot. A dev or test
// process uses Migrate instead.
func Verify(ctx context.Context, pool *pgxpool.Pool) error {
	migrator, err := rivermigrate.New(riverpgxv5.New(pool), nil)
	if err != nil {
		return fmt.Errorf("jobs: new migrator: %w", err)
	}
	res, err := migrator.Validate(ctx, nil)
	if err != nil {
		return fmt.Errorf("jobs: validate river schema: %w", err)
	}
	if !res.OK {
		return fmt.Errorf("%w (%s): run the migration Job, `task migrate`, or `river migrate-up` before starting", ErrSchemaNotMigrated, strings.Join(res.Messages, "; "))
	}
	return nil
}

func Start(ctx context.Context, client *Client) error {
	if err := client.Start(ctx); err != nil {
		return fmt.Errorf("jobs: start: %w", err)
	}
	return nil
}

func Stop(ctx context.Context, client *Client) error {
	if err := client.Stop(ctx); err != nil {
		return fmt.Errorf("jobs: stop: %w", err)
	}
	return nil
}
