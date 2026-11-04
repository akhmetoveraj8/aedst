// Package eventstest wires platform/events to a real River client for tests:
// a Publisher that inserts delivery jobs inside the test's transaction, helpers
// to read back the jobs it produced, and an optional started client that runs
// the consumers. Tests need a Postgres with River's schema (postgrestest.NewPool).
package eventstest

import (
	"context"
	"encoding/json"
	"log/slog"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"

	"github.com/aedst/server/internal/platform/events"
	platformjobs "github.com/aedst/server/internal/platform/jobs"
	sharedtime "github.com/aedst/server/internal/shared/time"
)

// Runtime is a registry, the events worker and a River client over one pool.
type Runtime struct {
	Registry  *events.Registry
	Publisher events.Publisher
	Client    *platformjobs.Client
	pool      *pgxpool.Pool
}

// New builds a Runtime whose client only inserts (never runs jobs) until Start
// is called. extra registers more workers (e.g. a module's push worker).
func New(t testing.TB, pool *pgxpool.Pool, extra ...func(*river.Workers)) *Runtime {
	t.Helper()
	return build(t, pool, nil, extra...)
}

// Start is New with a client that works the default queue: consumers run, and
// the client is stopped when the test ends.
func Start(t testing.TB, pool *pgxpool.Pool, extra ...func(*river.Workers)) *Runtime {
	t.Helper()
	rt := build(t, pool, map[string]int{river.QueueDefault: 5}, extra...)
	if err := platformjobs.Start(context.Background(), rt.Client); err != nil {
		t.Fatalf("eventstest: start river: %v", err)
	}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = platformjobs.Stop(ctx, rt.Client)
	})
	return rt
}

func build(t testing.TB, pool *pgxpool.Pool, queues map[string]int, extra ...func(*river.Workers)) *Runtime {
	t.Helper()
	logger := slog.New(slog.DiscardHandler)
	registry := events.NewRegistry()
	workers := river.NewWorkers()
	if err := events.Register(workers, registry, logger); err != nil {
		t.Fatalf("eventstest: register events worker: %v", err)
	}
	for _, add := range extra {
		add(workers)
	}
	client, err := platformjobs.NewClientWithQueues(pool, workers, logger, queues)
	if err != nil {
		t.Fatalf("eventstest: new river client: %v", err)
	}
	return &Runtime{
		Registry:  registry,
		Publisher: events.NewRiverPublisher(registry, client, sharedtime.Real{}),
		Client:    client,
		pool:      pool,
	}
}

// Capture subscribes a no-op consumer "test.capture" to each event type, so a
// producer's events become observable as delivery jobs (an event with no
// consumer is not inserted at all).
func (r *Runtime) Capture(eventTypes ...string) *Runtime {
	for _, typ := range eventTypes {
		r.Registry.Subscribe(typ, "test.capture."+typ, func(context.Context, events.Event) error { return nil })
	}
	return r
}

// Querier is the read side of a pool or transaction.
type Querier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

// Deliveries returns the delivery jobs for eventType (every event when empty),
// oldest first, whatever their state: this is the outbox, read back.
func Deliveries(ctx context.Context, q Querier, eventType string) ([]events.DeliveryArgs, error) {
	rows, err := q.Query(ctx,
		`SELECT args FROM river_job WHERE kind = $1 AND ($2 = '' OR args->>'event_type' = $2) ORDER BY id`,
		events.DeliveryKind, eventType)
	if err != nil {
		return nil, err
	}
	raw, err := pgx.CollectRows(rows, pgx.RowTo[[]byte])
	if err != nil {
		return nil, err
	}
	out := make([]events.DeliveryArgs, 0, len(raw))
	for _, b := range raw {
		var a events.DeliveryArgs
		if err := json.Unmarshal(b, &a); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, nil
}

// EventTypes is Deliveries reduced to the event types, for "what did this
// aggregate publish" assertions; partitionKey filters by aggregate when set.
func EventTypes(ctx context.Context, q Querier, partitionKey string) ([]string, error) {
	all, err := Deliveries(ctx, q, "")
	if err != nil {
		return nil, err
	}
	var types []string
	for _, a := range all {
		if partitionKey == "" || a.PartitionKey == partitionKey {
			types = append(types, a.EventType)
		}
	}
	return types, nil
}
