//go:build integration

package events_test

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river/riverdriver/riverpgxv5"
	"github.com/riverqueue/river/rivertest"

	"github.com/aedst/server/internal/platform/database"
	"github.com/aedst/server/internal/platform/events"
	"github.com/aedst/server/internal/platform/events/eventstest"
	"github.com/aedst/server/internal/platform/postgrestest"
	"github.com/aedst/server/internal/shared/ids"
)

const testType = "test.v1.Thing"

type payload struct {
	Name string `json:"name"`
}

func publishTx(t *testing.T, rt *eventstest.Runtime, pool *pgxpool.Pool, key ids.ID, name string) ids.ID {
	t.Helper()
	var id ids.ID
	err := database.WithTx(context.Background(), pool, func(ctx context.Context, tx pgx.Tx) error {
		var err error
		id, err = rt.Publisher.Publish(ctx, tx, testType, 1, key, payload{Name: name})
		return err
	})
	if err != nil {
		t.Fatalf("Publish() error = %v", err)
	}
	return id
}

func eventually(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(20 * time.Second)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", what)
}

// The job rides the producer's transaction: a rollback leaves nothing behind,
// a commit schedules exactly one delivery per subscribed consumer.
func TestPublisher_InsertsOneJobPerConsumerAtomicallyWithTheTransaction(t *testing.T) {
	pool := postgrestest.NewPool(t)
	rt := eventstest.New(t, pool)
	rt.Registry.Subscribe(testType, "test.one", func(context.Context, events.Event) error { return nil })
	rt.Registry.Subscribe(testType, "test.two", func(context.Context, events.Event) error { return nil })
	ctx := context.Background()

	rollback := errors.New("domain failure")
	err := database.WithTx(ctx, pool, func(ctx context.Context, tx pgx.Tx) error {
		if _, err := rt.Publisher.Publish(ctx, tx, testType, 1, ids.New(), payload{Name: "lost"}); err != nil {
			return err
		}
		return rollback
	})
	if !errors.Is(err, rollback) {
		t.Fatalf("WithTx() = %v, want the rollback error", err)
	}
	if got, _ := eventstest.Deliveries(ctx, pool, testType); len(got) != 0 {
		t.Fatalf("deliveries after a rolled-back transaction = %d, want 0", len(got))
	}

	key := ids.New()
	id := publishTx(t, rt, pool, key, "kept")
	got, err := eventstest.Deliveries(ctx, pool, testType)
	if err != nil || len(got) != 2 {
		t.Fatalf("deliveries = %d, %v; want one per consumer (2)", len(got), err)
	}
	consumers := map[string]bool{}
	for _, d := range got {
		consumers[d.Consumer] = true
		if d.EventID != id.String() || d.PartitionKey != key.String() || d.EventVersion != 1 || !jsonEqual(d.Payload, `{"name":"kept"}`) {
			t.Errorf("delivery = %+v, want event %s key %s v1 payload {name:kept}", d, id, key)
		}
	}
	if !consumers["test.one"] || !consumers["test.two"] {
		t.Errorf("consumers = %v, want test.one and test.two", consumers)
	}

	// rivertest sees the same jobs through River's own assertions.
	driver := riverpgxv5.New(pool)
	rivertest.RequireManyInserted(ctx, t, driver, []rivertest.ExpectedJob{{Args: events.DeliveryArgs{}}, {Args: events.DeliveryArgs{}}})
}

// An event nobody subscribed to costs nothing: no job is written.
func TestPublisher_NoConsumersWritesNothing(t *testing.T) {
	pool := postgrestest.NewPool(t)
	rt := eventstest.New(t, pool)
	publishTx(t, rt, pool, ids.New(), "ignored")
	if got, _ := eventstest.Deliveries(context.Background(), pool, ""); len(got) != 0 {
		t.Fatalf("deliveries = %d, want 0 for an unsubscribed event type", len(got))
	}
}

// The same (consumer, event id) cannot be queued twice.
func TestDelivery_UniqueByConsumerAndEvent(t *testing.T) {
	pool := postgrestest.NewPool(t)
	rt := eventstest.New(t, pool)
	ctx := context.Background()

	args := events.DeliveryArgs{
		Consumer: "test.one", EventID: ids.New().String(), EventType: testType, EventVersion: 1,
		PartitionKey: ids.New().String(), Payload: []byte(`{}`), OccurredAt: time.Now(),
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	first, err := rt.Client.InsertTx(ctx, tx, args, nil)
	if err != nil || first.UniqueSkippedAsDuplicate {
		t.Fatalf("first insert = %+v, %v", first, err)
	}
	second, err := rt.Client.InsertTx(ctx, tx, args, nil)
	if err != nil || !second.UniqueSkippedAsDuplicate {
		t.Fatalf("second insert = %+v, %v; want skipped as a duplicate", second, err)
	}
	// A different consumer of the same event is a different delivery.
	other := args
	other.Consumer = "test.two"
	third, err := rt.Client.InsertTx(ctx, tx, other, nil)
	if err != nil || third.UniqueSkippedAsDuplicate {
		t.Fatalf("other consumer insert = %+v, %v; want a new job", third, err)
	}
}

// End to end with a running River client: the consumer receives the event,
// a failing attempt is retried by River, and every consumer is served.
func TestDelivery_RunsConsumersAndRetriesFailures(t *testing.T) {
	pool := postgrestest.NewPool(t)
	rt := eventstest.Start(t, pool)

	var (
		mu       sync.Mutex
		received []events.Event
		flaky    atomic.Int32
		other    atomic.Int32
	)
	rt.Registry.Subscribe(testType, "test.record", func(_ context.Context, e events.Event) error {
		mu.Lock()
		defer mu.Unlock()
		received = append(received, e)
		return nil
	})
	rt.Registry.Subscribe(testType, "test.flaky", func(context.Context, events.Event) error {
		if flaky.Add(1) == 1 {
			return errors.New("transient failure")
		}
		return nil
	})
	rt.Registry.Subscribe(testType, "test.other", func(context.Context, events.Event) error { other.Add(1); return nil })

	key := ids.New()
	id := publishTx(t, rt, pool, key, "hello")

	eventually(t, "the recording consumer", func() bool { mu.Lock(); defer mu.Unlock(); return len(received) == 1 })
	mu.Lock()
	e := received[0]
	mu.Unlock()
	if e.ID != id || e.Type != testType || e.Version != 1 || e.PartitionKey != key || !jsonEqual(e.Payload, `{"name":"hello"}`) {
		t.Errorf("event = %+v, want id %s type %s key %s", e, id, testType, key)
	}

	// River retries the failed attempt with its backoff (about a second).
	eventually(t, "the flaky consumer to be retried", func() bool { return flaky.Load() >= 2 })
	eventually(t, "the other consumer", func() bool { return other.Load() == 1 })
	eventually(t, "all deliveries completed", func() bool {
		var done int
		_ = pool.QueryRow(context.Background(),
			`SELECT count(*) FROM river_job WHERE kind = $1 AND state = 'completed'`, events.DeliveryKind).Scan(&done)
		return done == 3
	})
	if n := flaky.Load(); n != 2 {
		t.Errorf("flaky consumer ran %d times, want exactly 2 (one failure, one success)", n)
	}
}

// jsonEqual compares JSON ignoring whitespace (jsonb normalises the payload).
func jsonEqual(got []byte, want string) bool {
	var a, b any
	return json.Unmarshal(got, &a) == nil && json.Unmarshal([]byte(want), &b) == nil && reflect.DeepEqual(a, b)
}
