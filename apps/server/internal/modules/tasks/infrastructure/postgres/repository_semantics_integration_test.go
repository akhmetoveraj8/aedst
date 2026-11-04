//go:build integration

package postgres_test

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/aedst/server/internal/modules/tasks/application"
	"github.com/aedst/server/internal/modules/tasks/domain"
	"github.com/aedst/server/internal/modules/tasks/infrastructure/postgres"
	sharederrors "github.com/aedst/server/internal/shared/errors"
	"github.com/aedst/server/internal/shared/ids"
	sharedtime "github.com/aedst/server/internal/shared/time"
)

// newTask builds a valid task the way application.Service does.
func newTask(t *testing.T, userID ids.ID, title string) domain.Task {
	t.Helper()
	task, err := domain.NewTask(ids.New(), userID, title, "", domain.PriorityLow, nil, time.Now().UTC().Truncate(time.Microsecond))
	if err != nil {
		t.Fatalf("NewTask: %v", err)
	}
	return task
}

func countOutbox(t *testing.T, pool *pgxpool.Pool) int {
	t.Helper()
	return completedDeliveries(t, pool)
}

// Completing twice — sequentially, or from several devices at once — moves the
// task to done once and publishes exactly one TaskCompleted event. A second
// event would have a different event_id, get its own delivery jobs and
// produce a duplicate notification.
func TestRepository_Complete_IsIdempotent(t *testing.T) {
	pool := newTestPool(t)
	repo := newRepository(t, pool)
	ctx := context.Background()

	userID := ids.New()
	created, err := repo.Create(ctx, newTask(t, userID, "Complete me"), "")
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}

	var wg sync.WaitGroup
	results := make([]domain.Task, 8)
	errs := make([]error, len(results))
	for i := range results {
		wg.Go(func() { results[i], errs[i] = repo.Complete(ctx, created.ID, userID, time.Now()) })
	}
	wg.Wait()
	for i, err := range errs {
		if err != nil {
			t.Fatalf("concurrent Complete() #%d error = %v", i, err)
		}
		if results[i].Status != domain.StatusDone {
			t.Errorf("Complete() #%d status = %v, want done", i, results[i].Status)
		}
	}
	if _, err := repo.Complete(ctx, created.ID, userID, time.Now()); err != nil {
		t.Fatalf("repeated Complete() error = %v", err)
	}

	if n := countOutbox(t, pool); n != 1 {
		t.Fatalf("TaskCompleted deliveries = %d after completing the same task many times, want exactly 1", n)
	}
	final, err := repo.FindByIDAndUserID(ctx, created.ID, userID)
	if err != nil {
		t.Fatalf("FindByIDAndUserID() error = %v", err)
	}
	if final.Version != created.Version+1 {
		t.Errorf("version = %d, want %d (one transition)", final.Version, created.Version+1)
	}
}

func TestRepository_Complete_OtherUsersTaskIsNotFound(t *testing.T) {
	pool := newTestPool(t)
	repo := newRepository(t, pool)
	ctx := context.Background()

	owner := ids.New()
	created, err := repo.Create(ctx, newTask(t, owner, "Mine"), "")
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	if _, err := repo.Complete(ctx, created.ID, ids.New(), time.Now()); sharederrors.KindOf(err) != sharederrors.KindNotFound {
		t.Fatalf("Complete() by another user = %v, want KindNotFound", err)
	}
	if n := countOutbox(t, pool); n != 0 {
		t.Fatalf("TaskCompleted deliveries = %d, want 0", n)
	}
}

func TestRepository_Reopen_IsIdempotent(t *testing.T) {
	pool := newTestPool(t)
	repo := newRepository(t, pool)
	ctx := context.Background()

	userID := ids.New()
	created, _ := repo.Create(ctx, newTask(t, userID, "Task"), "")
	if _, err := repo.Complete(ctx, created.ID, userID, time.Now()); err != nil {
		t.Fatalf("Complete() error = %v", err)
	}
	first, err := repo.Reopen(ctx, created.ID, userID, time.Now())
	if err != nil || first.Status != domain.StatusTodo || first.CompletedAt != nil {
		t.Fatalf("Reopen() = %+v, %v; want a todo task without completed_at", first, err)
	}
	second, err := repo.Reopen(ctx, created.ID, userID, time.Now())
	if err != nil || second.Version != first.Version {
		t.Fatalf("second Reopen() = version %d, %v; want unchanged version %d", second.Version, err, first.Version)
	}
	if _, err := repo.Reopen(ctx, ids.New(), userID, time.Now()); sharederrors.KindOf(err) != sharederrors.KindNotFound {
		t.Fatalf("Reopen() of a missing task = %v, want KindNotFound", err)
	}
}

func TestRepository_Update_PartialAndOptimistic(t *testing.T) {
	pool := newTestPool(t)
	repo := newRepository(t, pool)
	ctx := context.Background()

	userID := ids.New()
	due := time.Now().Add(48 * time.Hour).UTC().Truncate(time.Microsecond)
	task := newTask(t, userID, "Original")
	task.Description = "keep me"
	task.DueDate = &due
	created, err := repo.Create(ctx, task, "")
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}

	title := "Renamed"
	updated, err := repo.Update(ctx, application.UpdateParams{ID: created.ID, UserID: userID, Patch: domain.Patch{Title: &title}, UpdatedAt: time.Now()})
	if err != nil {
		t.Fatalf("Update() error = %v", err)
	}
	if updated.Title != "Renamed" || updated.Description != "keep me" || updated.DueDate == nil || updated.Priority != domain.PriorityLow {
		t.Fatalf("partial Update() changed more than the title: %+v", updated)
	}
	if updated.Version != created.Version+1 {
		t.Fatalf("version = %d, want %d", updated.Version, created.Version+1)
	}

	// A stale expected version is rejected and changes nothing.
	stale := created.Version
	other := "Stale write"
	_, err = repo.Update(ctx, application.UpdateParams{ID: created.ID, UserID: userID, Patch: domain.Patch{Title: &other}, ExpectedVersion: &stale, UpdatedAt: time.Now()})
	if sharederrors.KindOf(err) != sharederrors.KindConflict {
		t.Fatalf("Update() with a stale version = %v, want KindConflict", err)
	}
	current := updated.Version
	cleared, err := repo.Update(ctx, application.UpdateParams{ID: created.ID, UserID: userID, Patch: domain.Patch{SetDueDate: true}, ExpectedVersion: &current, UpdatedAt: time.Now()})
	if err != nil {
		t.Fatalf("Update() with the current version error = %v", err)
	}
	if cleared.DueDate != nil || cleared.Title != "Renamed" {
		t.Fatalf("clearing due_date = %+v, want due date gone and title kept", cleared)
	}

	if _, err := repo.Update(ctx, application.UpdateParams{ID: created.ID, UserID: ids.New(), Patch: domain.Patch{Title: &title}, UpdatedAt: time.Now()}); sharederrors.KindOf(err) != sharederrors.KindNotFound {
		t.Fatalf("Update() by another user = %v, want KindNotFound", err)
	}
}

// Two requests with the same Idempotency-Key racing each other (the client
// retried while the first attempt was still running) create ONE task.
func TestRepository_Create_ConcurrentSameKeyCreatesOnce(t *testing.T) {
	pool := newTestPool(t)
	repo := newRepository(t, pool)
	ctx := context.Background()

	userID := ids.New()
	const attempts = 12
	var wg sync.WaitGroup
	results := make([]domain.Task, attempts)
	errs := make([]error, attempts)
	for i := range attempts {
		wg.Go(func() { results[i], errs[i] = repo.Create(ctx, newTask(t, userID, "Same request"), "racing-key") })
	}
	wg.Wait()

	for i, err := range errs {
		if err != nil {
			t.Fatalf("Create() #%d error = %v", i, err)
		}
		if results[i].ID != results[0].ID {
			t.Fatalf("Create() #%d returned task %s, want the single original %s", i, results[i].ID, results[0].ID)
		}
	}
	listed, err := repo.List(ctx, application.ListParams{UserID: userID, SortBy: "created_at", SortDirection: "desc", Limit: 50})
	if err != nil || listed.Total != 1 {
		t.Fatalf("List() total = %d, %v; want exactly 1 task", listed.Total, err)
	}
}

// Idempotency keys are namespaced per user: two users may use the same key for
// different tasks, and one cannot replay or collide with the other's.
func TestRepository_Create_KeysAreScopedPerUser(t *testing.T) {
	pool := newTestPool(t)
	repo := newRepository(t, pool)
	ctx := context.Background()

	alice, bob := ids.New(), ids.New()
	a, err := repo.Create(ctx, newTask(t, alice, "Same title"), "shared-key")
	if err != nil {
		t.Fatalf("alice Create() error = %v", err)
	}
	b, err := repo.Create(ctx, newTask(t, bob, "Same title"), "shared-key")
	if err != nil {
		t.Fatalf("bob Create() error = %v", err)
	}
	if a.ID == b.ID || b.UserID != bob {
		t.Fatalf("users sharing a key must not share a task: alice %s, bob %s (owner %s)", a.ID, b.ID, b.UserID)
	}
}

type fakeReminders struct {
	calls int
	err   error
}

func (f *fakeReminders) EnqueueDueReminder(_ context.Context, _ pgx.Tx, _, _ ids.ID, _ time.Time) error {
	f.calls++
	return f.err
}

// The reminder job is enqueued in the task's own transaction: when enqueuing
// fails the task is not created either, and when it succeeds it is enqueued
// only for open tasks that have a future due date.
func TestRepository_Reminder_IsAtomicWithTheTaskChange(t *testing.T) {
	pool := newTestPool(t)
	ctx := context.Background()
	userID := ids.New()
	future := time.Now().Add(24 * time.Hour)
	writer := newPublisher(t, pool)

	failing := &fakeReminders{err: context.DeadlineExceeded}
	repo := postgres.NewRepository(pool, writer, sharedtime.Real{}, postgres.WithReminders(failing))
	task := newTask(t, userID, "Due soon")
	task.DueDate = &future
	if _, err := repo.Create(ctx, task, ""); err == nil {
		t.Fatal("Create() succeeded although the reminder could not be enqueued")
	}
	if _, err := repo.FindByIDAndUserID(ctx, task.ID, userID); sharederrors.KindOf(err) != sharederrors.KindNotFound {
		t.Fatalf("task exists after a failed Create(): %v", err)
	}

	ok := &fakeReminders{}
	repo = postgres.NewRepository(pool, writer, sharedtime.Real{}, postgres.WithReminders(ok))
	if _, err := repo.Create(ctx, newTask(t, userID, "No due date"), ""); err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	if ok.calls != 0 {
		t.Fatalf("reminder enqueued for a task without a due date (%d calls)", ok.calls)
	}
	dueTask := newTask(t, userID, "Has due date")
	dueTask.DueDate = &future
	created, err := repo.Create(ctx, dueTask, "")
	if err != nil || ok.calls != 1 {
		t.Fatalf("Create() = %v, reminder calls = %d; want 1", err, ok.calls)
	}
	later := future.Add(time.Hour)
	if _, err := repo.Update(ctx, application.UpdateParams{ID: created.ID, UserID: userID, Patch: domain.Patch{SetDueDate: true, DueDate: &later}, UpdatedAt: time.Now()}); err != nil || ok.calls != 2 {
		t.Fatalf("Update(due_date) = %v, reminder calls = %d; want 2", err, ok.calls)
	}
	title := "Just a rename"
	if _, err := repo.Update(ctx, application.UpdateParams{ID: created.ID, UserID: userID, Patch: domain.Patch{Title: &title}, UpdatedAt: time.Now()}); err != nil || ok.calls != 2 {
		t.Fatalf("Update(title) = %v, reminder calls = %d; want still 2", err, ok.calls)
	}
}
