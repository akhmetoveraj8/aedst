// Package jobs holds tasks' River job kinds (deferred work owned solely by
// this module, see docs/content/decisions/0005-river-for-jobs.md). DueReminderWorker
// is registered with the shared River client in cmd/server and enqueued by the
// repository inside the transaction that sets a task's due date.
package jobs

import (
	"context"
	"log/slog"
	"time"

	"github.com/riverqueue/river"

	sharederrors "github.com/aedst/server/internal/shared/errors"
	"github.com/aedst/server/internal/shared/ids"
)

// DueSoonMarker publishes tasks.v1.TaskDueSoon at most once per (task, due
// date), guarded in SQL; it reports whether it published. Satisfied by the
// postgres repository (on the jobs pool).
type DueSoonMarker interface {
	MarkDueSoon(ctx context.Context, id, userID ids.ID, dueDate time.Time) (bool, error)
}

// DueReminderArgs is the payload of the "due soon" job, enqueued when a task
// gets a due date.
type DueReminderArgs struct {
	TaskID  string `json:"task_id" river:"unique"`
	UserID  string `json:"user_id"`
	DueDate int64  `json:"due_date" river:"unique"` // Unix seconds, the due_date this job was scheduled for.
	// LeadSeconds is how long before DueDate the job runs
	// (AEDST_TASKS_DUE_SOON_LEAD_MINUTES at scheduling time).
	LeadSeconds int64 `json:"lead_seconds,omitempty"`
}

func (DueReminderArgs) Kind() string { return "tasks.due_reminder" }

// InsertOpts schedules the job LeadSeconds before the due date (immediately
// when that moment has passed). River runs it no earlier than ScheduledAt.
func (a DueReminderArgs) InsertOpts() river.InsertOpts {
	// Unique per (task, due date): saving a task again without moving its due
	// date must not queue a second identical reminder.
	return river.InsertOpts{
		ScheduledAt: time.Unix(a.DueDate-a.LeadSeconds, 0).UTC(),
		UniqueOpts:  river.UniqueOpts{ByArgs: true},
	}
}

// DueReminderWorker publishes TaskDueSoon (the notifications module turns it
// into an in-app notification and a push). Stale jobs — task deleted, done,
// or due date moved since scheduling — publish nothing and succeed.
type DueReminderWorker struct {
	river.WorkerDefaults[DueReminderArgs]

	Tasks  DueSoonMarker
	Logger *slog.Logger
}

func NewDueReminderWorker(tasks DueSoonMarker, logger *slog.Logger) *DueReminderWorker {
	return &DueReminderWorker{Tasks: tasks, Logger: logger}
}

func (w *DueReminderWorker) Work(ctx context.Context, job *river.Job[DueReminderArgs]) error {
	taskID, err := ids.Parse(job.Args.TaskID)
	if err != nil {
		return river.JobCancel(err)
	}
	userID, err := ids.Parse(job.Args.UserID)
	if err != nil {
		return river.JobCancel(err)
	}

	published, err := w.Tasks.MarkDueSoon(ctx, taskID, userID, time.Unix(job.Args.DueDate, 0).UTC())
	if err != nil {
		if sharederrors.KindOf(err) == sharederrors.KindNotFound {
			return nil
		}
		return err
	}
	if !published {
		w.Logger.DebugContext(ctx, "due reminder: nothing to publish (done, deleted, moved or already sent)", slog.String("task_id", taskID.String()))
		return nil
	}
	w.Logger.InfoContext(ctx, "task due reminder", slog.String("task_id", taskID.String()), slog.String("user_id", userID.String()))
	return nil
}
