//go:build integration

package postgres_test

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/aedst/server/internal/modules/tasks/api"
	"github.com/aedst/server/internal/modules/tasks/application"
	"github.com/aedst/server/internal/modules/tasks/domain"
	"github.com/aedst/server/internal/platform/events/eventstest"
	sharederrors "github.com/aedst/server/internal/shared/errors"
	"github.com/aedst/server/internal/shared/ids"
)

// Every write RPC a client can queue offline and replay (the outbox sends the
// item id as Idempotency-Key) must be safe to deliver twice: UpdateTask and
// DeleteTask carry the key; CreateTask is covered in postgres_integration_test.go;
// CompleteTask / ReopenTask are idempotent by their guarded SQL.
func TestRepository_Update_IdempotentReplay(t *testing.T) {
	pool := newTestPool(t)
	repo := newRepository(t, pool)
	ctx := context.Background()
	userID := ids.New()
	created, err := repo.Create(ctx, newTask(t, userID, "Original"), "")
	if err != nil {
		t.Fatal(err)
	}

	title := "Renamed"
	one := created.Version
	params := application.UpdateParams{ID: created.ID, UserID: userID, Patch: domain.Patch{Title: &title}, ExpectedVersion: &one, UpdatedAt: time.Now(), IdempotencyKey: "outbox-item-1"}
	first, err := repo.Update(ctx, params)
	if err != nil {
		t.Fatalf("first Update() = %v", err)
	}

	// The retry carries the same expected version, which is now stale: without
	// the key this is a Conflict; with it, the first result is replayed.
	second, err := repo.Update(ctx, params)
	if err != nil {
		t.Fatalf("replayed Update() = %v, want the first result", err)
	}
	if second.Version != first.Version || second.Title != "Renamed" || second.ID != first.ID {
		t.Fatalf("replay = %+v, want %+v", second, first)
	}
	again, err := repo.FindByIDAndUserID(ctx, created.ID, userID)
	if err != nil || again.Version != first.Version {
		t.Fatalf("version after replay = %d (%v), want %d: the write must happen once", again.Version, err, first.Version)
	}
	got, err := eventstest.Deliveries(ctx, pool, api.TaskUpdatedEventType)
	if err != nil || len(got) != 1 {
		t.Fatalf("TaskUpdated deliveries = %d (%v), want exactly 1", len(got), err)
	}

	// The same key for a different update is key reuse, not a replay.
	other := "Something else"
	params.Patch = domain.Patch{Title: &other}
	if _, err := repo.Update(ctx, params); sharederrors.KindOf(err) != sharederrors.KindConflict {
		t.Fatalf("Update() with a reused key and another payload = %v, want KindConflict", err)
	}

	// Keys are per user.
	if _, err := repo.Update(ctx, application.UpdateParams{ID: created.ID, UserID: ids.New(), Patch: domain.Patch{Title: &other}, UpdatedAt: time.Now(), IdempotencyKey: "outbox-item-1"}); sharederrors.KindOf(err) != sharederrors.KindNotFound {
		t.Fatalf("another user's Update() with the same key = %v, want KindNotFound (no replay across users)", err)
	}
}

// Two deliveries of the same queued update racing each other (a flaky
// connection plus a second tab) execute once.
func TestRepository_Update_ConcurrentSameKeyExecutesOnce(t *testing.T) {
	pool := newTestPool(t)
	repo := newRepository(t, pool)
	ctx := context.Background()
	userID := ids.New()
	created, err := repo.Create(ctx, newTask(t, userID, "Race"), "")
	if err != nil {
		t.Fatal(err)
	}
	title := "Winner"
	v := created.Version
	var wg sync.WaitGroup
	results := make([]domain.Task, 6)
	errs := make([]error, len(results))
	for i := range results {
		wg.Go(func() {
			results[i], errs[i] = repo.Update(ctx, application.UpdateParams{ID: created.ID, UserID: userID, Patch: domain.Patch{Title: &title}, ExpectedVersion: &v, UpdatedAt: time.Now(), IdempotencyKey: "race-key"})
		})
	}
	wg.Wait()
	for i := range results {
		if errs[i] != nil || results[i].Version != created.Version+1 {
			t.Fatalf("call %d = %+v, %v; want every call to return the one update", i, results[i], errs[i])
		}
	}
	if got, err := eventstest.Deliveries(ctx, pool, api.TaskUpdatedEventType); err != nil || len(got) != 1 {
		t.Fatalf("TaskUpdated deliveries = %d (%v), want 1", len(got), err)
	}
}

func TestRepository_Delete_IdempotentReplay(t *testing.T) {
	pool := newTestPool(t)
	repo := newRepository(t, pool)
	ctx := context.Background()
	userID := ids.New()
	created, err := repo.Create(ctx, newTask(t, userID, "Delete me"), "")
	if err != nil {
		t.Fatal(err)
	}

	if err := repo.Delete(ctx, created.ID, userID, "outbox-del-1"); err != nil {
		t.Fatalf("first Delete() = %v", err)
	}
	if err := repo.Delete(ctx, created.ID, userID, "outbox-del-1"); err != nil {
		t.Fatalf("replayed Delete() = %v, want success (the first one already committed)", err)
	}
	if got, err := eventstest.Deliveries(ctx, pool, api.TaskDeletedEventType); err != nil || len(got) != 1 {
		t.Fatalf("TaskDeleted deliveries = %d (%v), want 1", len(got), err)
	}
	// Without the key a second delete is an honest NotFound.
	if err := repo.Delete(ctx, created.ID, userID, ""); sharederrors.KindOf(err) != sharederrors.KindNotFound {
		t.Fatalf("keyless second Delete() = %v, want KindNotFound", err)
	}
	// A key used for one task's delete cannot be replayed to delete another.
	other, err := repo.Create(ctx, newTask(t, userID, "Other"), "")
	if err != nil {
		t.Fatal(err)
	}
	if err := repo.Delete(ctx, other.ID, userID, "outbox-del-1"); sharederrors.KindOf(err) != sharederrors.KindConflict {
		t.Fatalf("Delete() of another task with a reused key = %v, want KindConflict", err)
	}
	if _, err := repo.FindByIDAndUserID(ctx, other.ID, userID); err != nil {
		t.Fatalf("the other task must survive: %v", err)
	}
}
