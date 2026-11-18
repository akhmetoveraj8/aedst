package main

import (
	"cmp"
	"context"
	"time"

	"github.com/riverqueue/river"

	"github.com/aedst/server/internal/platform/events"
	"github.com/aedst/server/internal/platform/idempotency"
	platformjobs "github.com/aedst/server/internal/platform/jobs"
	"github.com/aedst/server/internal/platform/retention"
)

// buildJobs wires background jobs (River, see
// docs/content/decisions/0005-river-for-jobs.md).
//
// River runs deferred jobs (reminders, push delivery, media processing,
// cleanup) AND integration events: a producer inserts one River job per
// consumer inside its own transaction (platform/events, ADR-0014), and the
// events worker runs the consumer's handler. Each module registers its workers
// and consumers from its Setup (modulekit); this is the only place the client
// is built. AEDST_JOBS_QUEUES decides which queues THIS process works, so a
// dedicated worker deployment can run only "media" (heavy processing) while
// API replicas run "default".
func (a *app) buildJobs(ctx context.Context) error {
	cfg, env := a.cfg, a.env
	env.Workers = river.NewWorkers()
	// Deployed environments only verify River's schema: it is migrated once per
	// release by the migration Job (river migrate-up), not by every replica at
	// boot. Development and test processes migrate themselves.
	prepare := platformjobs.Migrate
	if cfg.Env.IsDeployed() {
		prepare = platformjobs.Verify
	}
	if err := prepare(ctx, env.JobsPool); err != nil {
		return err
	}
	// The consumer registry is filled by the modules; the single events worker
	// (registered in every process, River validates kinds on insert)
	// dispatches each delivery job to the consumer it names.
	env.Events = events.NewRegistry()
	// Units hosted elsewhere subscribe to events too: catalogue their consumers so
	// a producer here still inserts their deliveries (onto their own queues).
	a.plan.RegisterRemoteConsumers(env.Events)
	if err := events.Register(env.Workers, env.Events, a.logger); err != nil {
		return err
	}
	if err := platformjobs.RegisterMetrics(env.JobsPool); err != nil {
		return err
	}

	retentionJobs, err := retention.Register(env.Workers, a.retentionPolicies(), time.Duration(cfg.Retention.IntervalMinutes)*time.Minute, a.logger)
	if err != nil {
		return err
	}
	env.Jobs, err = platformjobs.NewClientWithOptions(env.JobsPool, env.Workers, a.logger,
		platformjobs.Options{
			Queues: a.workedQueues(), PollOnly: cfg.Jobs.PollOnly,
			CompletedRetention:   time.Duration(cfg.Jobs.CompletedRetentionHours) * time.Hour,
			CancelledRetention:   time.Duration(cfg.Jobs.CancelledRetentionHours) * time.Hour,
			DiscardedRetention:   time.Duration(cfg.Jobs.DiscardedRetentionHours) * time.Hour,
			SoftStopTimeout:      platformjobs.SoftStopFor(time.Duration(cfg.HTTP.ShutdownTimeout) * time.Second),
			RescueStuckJobsAfter: platformjobs.RescueAfter(platformjobs.MaxJobTimeout),
		}, retentionJobs...)
	if err != nil {
		return err
	}

	// Integration events (ADR-0014): the publisher inserts one River job per
	// subscribed consumer inside the producer's own transaction (any pool: the
	// insert rides the caller's pgx.Tx); consumers subscribe on the registry
	// and are run by the events worker on the jobs pool.
	env.Publisher = events.NewRiverPublisher(env.Events, env.Jobs, a.clock)
	return nil
}

// workedQueues is what this process works: AEDST_JOBS_QUEUES plus, when it works
// "default", the event queue (events_<unit>) of every unit it hosts that subscribes
// to events. A media-only worker therefore takes no deliveries, an insert-only
// replica works nothing, and the monolith works every unit's queue as it worked
// the one shared queue before.
func (a *app) workedQueues() map[string]int {
	return events.WorkedQueues(a.cfg.Jobs.Queues, a.plan.ConsumingUnits(), cmp.Or(a.cfg.Jobs.EventWorkers, defaultEventWorkers))
}

// defaultEventWorkers is AEDST_JOBS_EVENT_WORKERS's default, for a zero Config.
const defaultEventWorkers = 10

// retentionPolicies keeps the append-only tables bounded (one leader-elected
// River periodic job per policy): the platform's own table plus whatever each
// registered module declares. Finished River jobs (event deliveries) are
// cleaned by River itself, see Options.*Retention.
func (a *app) retentionPolicies() []retention.Policy {
	policies := []retention.Policy{{
		Name:      "platform.idempotency_keys",
		Retention: time.Duration(a.cfg.Retention.IdempotencyHours) * time.Hour,
		Purge: func(ctx context.Context, cutoff time.Time, limit int) (int64, error) {
			return idempotency.Purge(ctx, a.env.JobsPool, cutoff, limit)
		},
	}}
	for _, m := range a.mods {
		if m.Retention != nil {
			policies = append(policies, m.Retention(a.env)...)
		}
	}
	return policies
}
