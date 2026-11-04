//go:build integration

package postgres_test

import (
	"context"
	"log/slog"
	"testing"
	"time"

	"github.com/riverqueue/river"

	"github.com/aedst/server/internal/modules/tasks/application"
	"github.com/aedst/server/internal/modules/tasks/domain"
	tasksjobsinfra "github.com/aedst/server/internal/modules/tasks/infrastructure/jobs"
	"github.com/aedst/server/internal/modules/tasks/infrastructure/postgres"
	tasksjobs "github.com/aedst/server/internal/modules/tasks/jobs"
	platformjobs "github.com/aedst/server/internal/platform/jobs"
	"github.com/aedst/server/internal/shared/ids"
	sharedtime "github.com/aedst/server/internal/shared/time"
)

// With the real River client: the reminder job lands in river_job in the same
// transaction as the task, is scheduled for the due date, and saving the task
// again without moving its due date does not queue a duplicate.
func TestRepository_RealRiverReminderJob(t *testing.T) {
	pool := newTestPool(t)
	ctx := context.Background()

	workers := river.NewWorkers()
	river.AddWorker(workers, tasksjobs.NewDueReminderWorker(nil, slog.New(slog.DiscardHandler)))
	client, err := platformjobs.NewClient(pool, workers, slog.New(slog.DiscardHandler)) // never started: we only insert
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}
	repo := postgres.NewRepository(pool, newPublisher(t, pool), sharedtime.Real{},
		postgres.WithReminders(tasksjobsinfra.NewScheduler(client, 0)))

	countJobs := func() (n int) {
		t.Helper()
		if err := pool.QueryRow(ctx, `SELECT count(*) FROM river_job WHERE kind = 'tasks.due_reminder'`).Scan(&n); err != nil {
			t.Fatalf("count jobs: %v", err)
		}
		return n
	}

	userID := ids.New()
	due := time.Now().Add(72 * time.Hour).UTC().Truncate(time.Second)
	task := newTask(t, userID, "Ship it")
	task.DueDate = &due
	created, err := repo.Create(ctx, task, "")
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if n := countJobs(); n != 1 {
		t.Fatalf("reminder jobs after Create = %d, want 1", n)
	}
	var scheduledAt time.Time
	if err := pool.QueryRow(ctx, `SELECT scheduled_at FROM river_job WHERE kind = 'tasks.due_reminder'`).Scan(&scheduledAt); err != nil || !scheduledAt.Equal(due) {
		t.Fatalf("scheduled_at = %v, %v; want the due date %v", scheduledAt, err, due)
	}

	// Same due date again: deduplicated by (task, due date).
	if _, err := repo.Update(ctx, application.UpdateParams{ID: created.ID, UserID: userID, Patch: domain.Patch{SetDueDate: true, DueDate: &due}, UpdatedAt: time.Now()}); err != nil {
		t.Fatalf("Update(same due date): %v", err)
	}
	if n := countJobs(); n != 1 {
		t.Fatalf("reminder jobs after re-saving the same due date = %d, want still 1", n)
	}

	// A new due date is a new reminder; the old one no-ops when it fires.
	later := due.Add(24 * time.Hour)
	if _, err := repo.Update(ctx, application.UpdateParams{ID: created.ID, UserID: userID, Patch: domain.Patch{SetDueDate: true, DueDate: &later}, UpdatedAt: time.Now()}); err != nil {
		t.Fatalf("Update(new due date): %v", err)
	}
	if n := countJobs(); n != 2 {
		t.Fatalf("reminder jobs after moving the due date = %d, want 2", n)
	}
}
