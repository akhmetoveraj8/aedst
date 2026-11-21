package events_test

import (
	"context"
	"errors"
	"slices"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/rivertype"

	mediaapi "github.com/aedst/server/internal/modules/media/api"
	tasksapi "github.com/aedst/server/internal/modules/tasks/api"
	"github.com/aedst/server/internal/modules/webhooks/infrastructure/events"
	platformevents "github.com/aedst/server/internal/platform/events"
	"github.com/aedst/server/internal/platform/webhooks"
	"github.com/aedst/server/internal/shared/ids"
	sharedtime "github.com/aedst/server/internal/shared/time"
)

var now = time.Date(2026, 11, 21, 10, 0, 0, 0, time.UTC)

// fakeStore is the delivery table in memory: endpoints by subscribed event type
// and the (endpoint, event) pairs that already have a row.
type fakeStore struct {
	subscribed map[string][]ids.ID
	rows       map[[2]ids.ID][]byte
	insertedAt time.Time
	err        error
}

func (f *fakeStore) SubscribedEndpointIDs(_ context.Context, _ pgx.Tx, eventType string) ([]ids.ID, error) {
	return f.subscribed[eventType], f.err
}

func (f *fakeStore) InsertDeliveries(_ context.Context, _ pgx.Tx, eventID ids.ID, _ string, payload []byte, endpoints []ids.ID, at time.Time) ([]ids.ID, error) {
	var inserted []ids.ID
	for _, endpoint := range endpoints {
		key := [2]ids.ID{endpoint, eventID}
		if _, dup := f.rows[key]; dup {
			continue // UNIQUE (endpoint_id, event_id) ... ON CONFLICT DO NOTHING
		}
		f.rows[key] = payload
		inserted = append(inserted, endpoint)
	}
	f.insertedAt = at
	return inserted, nil
}

type fakeJobs struct {
	args []webhooks.DeliveryArgs
	err  error
}

func (f *fakeJobs) InsertManyTx(_ context.Context, _ pgx.Tx, params []river.InsertManyParams) ([]*rivertype.JobInsertResult, error) {
	if f.err != nil {
		return nil, f.err
	}
	for _, p := range params {
		f.args = append(f.args, p.Args.(webhooks.DeliveryArgs))
	}
	return nil, nil
}

// noTx runs the handler body without a database: the fakes ignore the tx.
func noTx(ctx context.Context, fn func(ctx context.Context, tx pgx.Tx) error) error {
	return fn(ctx, nil)
}

func setup(store *fakeStore, jobs *fakeJobs) *platformevents.Registry {
	registry := platformevents.NewRegistry()
	events.Subscribe(registry, noTx, store, jobs, sharedtime.Fixed{At: now})
	return registry
}

func event(eventType string) platformevents.Event {
	return platformevents.Event{ID: ids.New(), Type: eventType, Version: 1, OccurredAt: now, Payload: []byte(`{"task_id":"t-1","title":"Write the release notes"}`)}
}

func TestFanOut_OneDeliveryAndOneJobPerSubscribedEndpoint(t *testing.T) {
	a, b, other := ids.New(), ids.New(), ids.New()
	store := &fakeStore{rows: map[[2]ids.ID][]byte{}, subscribed: map[string][]ids.ID{
		tasksapi.TaskCompletedEventType: {a, b},
		mediaapi.MediaReadyEventType:    {other},
	}}
	jobs := &fakeJobs{}
	e := event(tasksapi.TaskCompletedEventType)
	if err := setup(store, jobs).Dispatch(context.Background(), e); err != nil {
		t.Fatalf("Dispatch() = %v", err)
	}
	if len(store.rows) != 2 || len(jobs.args) != 2 {
		t.Fatalf("%d delivery rows and %d jobs, want 2 and 2", len(store.rows), len(jobs.args))
	}
	if !store.insertedAt.Equal(now) {
		t.Errorf("deliveries were stamped %v, want the clock's %v", store.insertedAt, now)
	}
	var endpoints []string
	for _, args := range jobs.args {
		endpoints = append(endpoints, args.EndpointID)
		if args.EventID != e.ID.String() || args.EventType != e.Type || string(args.Payload) != string(e.Payload) {
			t.Errorf("job args = %+v, want the event id, type and payload byte for byte", args)
		}
		if args.Kind() != webhooks.DeliveryKind {
			t.Errorf("job kind = %s, want %s", args.Kind(), webhooks.DeliveryKind)
		}
	}
	if !slices.Contains(endpoints, a.String()) || !slices.Contains(endpoints, b.String()) || slices.Contains(endpoints, other.String()) {
		t.Errorf("jobs went to %v, want exactly the two endpoints subscribed to the type", endpoints)
	}
}

func TestFanOut_RedeliveredEventEnqueuesNothingTwice(t *testing.T) {
	a := ids.New()
	store := &fakeStore{rows: map[[2]ids.ID][]byte{}, subscribed: map[string][]ids.ID{tasksapi.TaskCreatedEventType: {a}}}
	jobs := &fakeJobs{}
	registry := setup(store, jobs)
	e := event(tasksapi.TaskCreatedEventType)
	for range 3 { // River delivers at least once
		if err := registry.Dispatch(context.Background(), e); err != nil {
			t.Fatalf("Dispatch() = %v", err)
		}
	}
	if len(store.rows) != 1 || len(jobs.args) != 1 {
		t.Fatalf("%d rows and %d jobs after three deliveries of one event, want 1 and 1", len(store.rows), len(jobs.args))
	}
	// A different event of the same type is a new delivery.
	if err := registry.Dispatch(context.Background(), event(tasksapi.TaskCreatedEventType)); err != nil || len(jobs.args) != 2 {
		t.Fatalf("a second event produced %d jobs (%v), want 2", len(jobs.args), err)
	}
}

func TestFanOut_NoSubscribedEndpointWritesNothing(t *testing.T) {
	store := &fakeStore{rows: map[[2]ids.ID][]byte{}, subscribed: map[string][]ids.ID{}}
	jobs := &fakeJobs{}
	if err := setup(store, jobs).Dispatch(context.Background(), event(tasksapi.TaskDeletedEventType)); err != nil {
		t.Fatalf("Dispatch() = %v", err)
	}
	if len(store.rows) != 0 || len(jobs.args) != 0 {
		t.Fatalf("%d rows and %d jobs with no endpoint, want none", len(store.rows), len(jobs.args))
	}
}

func TestFanOut_FailuresAreReturnedSoRiverRetries(t *testing.T) {
	a := ids.New()
	subscribed := map[string][]ids.ID{tasksapi.TaskUpdatedEventType: {a}}
	storeErr := &fakeStore{rows: map[[2]ids.ID][]byte{}, subscribed: subscribed, err: errors.New("db down")}
	if err := setup(storeErr, &fakeJobs{}).Dispatch(context.Background(), event(tasksapi.TaskUpdatedEventType)); err == nil {
		t.Fatal("a store failure was swallowed")
	}
	store := &fakeStore{rows: map[[2]ids.ID][]byte{}, subscribed: subscribed}
	if err := setup(store, &fakeJobs{err: errors.New("insert failed")}).Dispatch(context.Background(), event(tasksapi.TaskUpdatedEventType)); err == nil {
		t.Fatal("a job insert failure was swallowed: the transaction would commit rows without jobs")
	}
}

func TestSubscribe_CoversEveryOfferedEventType(t *testing.T) {
	registry := setup(&fakeStore{rows: map[[2]ids.ID][]byte{}}, &fakeJobs{})
	for _, eventType := range []string{
		tasksapi.TaskCreatedEventType, tasksapi.TaskUpdatedEventType, tasksapi.TaskCompletedEventType,
		tasksapi.TaskDeletedEventType, tasksapi.TaskDueSoonEventType,
		mediaapi.MediaReadyEventType, mediaapi.MediaDeletedEventType,
	} {
		consumers := registry.Consumers(eventType)
		if len(consumers) != 1 || platformevents.QueueFor(consumers[0]) != "events_webhooks" {
			t.Errorf("%s has consumers %v, want one on the events_webhooks queue", eventType, consumers)
		}
	}
}
