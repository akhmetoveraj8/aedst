package jobs_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/rivertype"

	"github.com/aedst/server/internal/modules/tasks/infrastructure/jobs"
	tasksjobs "github.com/aedst/server/internal/modules/tasks/jobs"
	"github.com/aedst/server/internal/shared/ids"
)

type inserter struct {
	args river.JobArgs
	err  error
}

func (i *inserter) InsertTx(_ context.Context, _ pgx.Tx, args river.JobArgs, _ *river.InsertOpts) (*rivertype.JobInsertResult, error) {
	i.args = args
	return &rivertype.JobInsertResult{}, i.err
}

func TestScheduler_EnqueuesTheReminderInTheCallersTransaction(t *testing.T) {
	ins := &inserter{}
	task, user := ids.New(), ids.New()
	due := time.Unix(1_900_000_000, 0)

	if err := jobs.NewScheduler(ins, 0).EnqueueDueReminder(context.Background(), nil, task, user, due); err != nil {
		t.Fatalf("EnqueueDueReminder: %v", err)
	}
	got, ok := ins.args.(tasksjobs.DueReminderArgs)
	if !ok || got.TaskID != task.String() || got.UserID != user.String() || got.DueDate != due.Unix() {
		t.Fatalf("enqueued %+v, want the task, user and due date", ins.args)
	}

	ins.err = errors.New("river down")
	if err := jobs.NewScheduler(ins, 0).EnqueueDueReminder(context.Background(), nil, task, user, due); err == nil {
		t.Fatal("an enqueue failure must propagate so the task change rolls back")
	}
}
