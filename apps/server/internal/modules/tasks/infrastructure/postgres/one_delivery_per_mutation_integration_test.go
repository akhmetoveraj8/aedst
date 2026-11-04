//go:build integration

package postgres_test

import (
	"context"
	"testing"
	"time"

	"github.com/aedst/server/internal/modules/tasks/api"
	"github.com/aedst/server/internal/platform/events/eventstest"
	"github.com/aedst/server/internal/shared/ids"
)

// One real state change publishes exactly one event, however often the request is
// retried: the guarded UPDATE finds no row the second time and publishes nothing.
// Reopen publishes TaskUpdated (it used to publish nothing, so the search projection
// kept a reopened task as done).
func TestRepository_EachMutationPublishesExactlyOneEvent(t *testing.T) {
	pool := newTestPool(t)
	repo := newRepository(t, pool)
	ctx := context.Background()
	userID := ids.New()
	created, err := repo.Create(ctx, newTask(t, userID, "Ship"), "")
	if err != nil {
		t.Fatal(err)
	}
	count := func(eventType string) int {
		t.Helper()
		got, err := eventstest.Deliveries(ctx, pool, eventType)
		if err != nil {
			t.Fatal(err)
		}
		return len(got)
	}

	for range 3 {
		if _, err := repo.Complete(ctx, created.ID, userID, time.Now()); err != nil {
			t.Fatal(err)
		}
	}
	if got := count(api.TaskCompletedEventType); got != 1 {
		t.Fatalf("TaskCompleted deliveries after 3 completes = %d, want 1", got)
	}
	updatedBefore := count(api.TaskUpdatedEventType)

	for range 3 {
		if _, err := repo.Reopen(ctx, created.ID, userID, time.Now()); err != nil {
			t.Fatal(err)
		}
	}
	if got := count(api.TaskUpdatedEventType) - updatedBefore; got != 1 {
		t.Fatalf("TaskUpdated deliveries after 3 reopens = %d, want exactly 1 (one transition, one event)", got)
	}

	// Reopening a task that is not done, or is someone else's, publishes nothing.
	if _, err := repo.Reopen(ctx, ids.New(), userID, time.Now()); err == nil {
		t.Fatal("reopening a missing task must fail")
	}
	if got := count(api.TaskUpdatedEventType) - updatedBefore; got != 1 {
		t.Fatalf("a failed Reopen published an event: %d", got)
	}
}
