// Package jobs implements the tasks module's reminder enqueuing on top of
// platform/jobs' shared River client (see
// docs/content/decisions/0005-river-for-jobs.md). Not imported outside this module.
package jobs

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/rivertype"

	tasksjobs "github.com/aedst/server/internal/modules/tasks/jobs"
	"github.com/aedst/server/internal/shared/ids"
)

// TxJobInserter is the subset of *platform/jobs.Client the scheduler needs —
// kept minimal so tests can fake it without a real River client.
type TxJobInserter interface {
	InsertTx(ctx context.Context, tx pgx.Tx, args river.JobArgs, opts *river.InsertOpts) (*rivertype.JobInsertResult, error)
}

type Scheduler struct {
	jobs TxJobInserter
	lead time.Duration
}

// NewScheduler builds the scheduler. lead is how long before the due date the
// "due soon" job runs (AEDST_TASKS_DUE_SOON_LEAD_MINUTES).
func NewScheduler(jobs TxJobInserter, lead time.Duration) *Scheduler {
	return &Scheduler{jobs: jobs, lead: lead}
}

// EnqueueDueReminder inserts the reminder job inside tx — the transaction of
// the task change itself — so the job exists exactly when the change
// committed: no lost reminder if the process dies after commit, no reminder
// for a rolled-back task. River dedupes jobs by (task, due date), so
// re-saving a task without changing its due date adds nothing.
func (s *Scheduler) EnqueueDueReminder(ctx context.Context, tx pgx.Tx, taskID, userID ids.ID, dueDate time.Time) error {
	_, err := s.jobs.InsertTx(ctx, tx, tasksjobs.DueReminderArgs{
		TaskID:      taskID.String(),
		UserID:      userID.String(),
		DueDate:     dueDate.Unix(),
		LeadSeconds: int64(s.lead.Seconds()),
	}, nil)
	return err
}
