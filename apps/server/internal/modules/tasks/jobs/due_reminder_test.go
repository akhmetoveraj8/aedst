package jobs_test

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"strings"
	"testing"
	"time"

	"github.com/riverqueue/river"
	"github.com/riverqueue/river/rivertype"

	"github.com/aedst/server/internal/modules/tasks/jobs"
	sharederrors "github.com/aedst/server/internal/shared/errors"
	"github.com/aedst/server/internal/shared/ids"
)

type marker struct {
	published bool
	err       error
	gotDue    time.Time
}

func (m *marker) MarkDueSoon(_ context.Context, _, _ ids.ID, due time.Time) (bool, error) {
	m.gotDue = due
	return m.published, m.err
}

func run(t *testing.T, m *marker, args jobs.DueReminderArgs) (logs string, err error) {
	t.Helper()
	var buf bytes.Buffer
	worker := jobs.NewDueReminderWorker(m, slog.New(slog.NewTextHandler(&buf, nil)))
	err = worker.Work(context.Background(), &river.Job[jobs.DueReminderArgs]{JobRow: &rivertype.JobRow{}, Args: args})
	return buf.String(), err
}

func TestDueReminderWorker(t *testing.T) {
	taskID, userID := ids.New(), ids.New()
	due := time.Now().Add(time.Hour).Truncate(time.Second).UTC()
	args := jobs.DueReminderArgs{TaskID: taskID.String(), UserID: userID.String(), DueDate: due.Unix()}

	t.Run("publishes for the scheduled due date", func(t *testing.T) {
		m := &marker{published: true}
		logs, err := run(t, m, args)
		if err != nil || !strings.Contains(logs, "task due reminder") || !m.gotDue.Equal(due) {
			t.Fatalf("Work = %v, logs %q, due %v; want a reminder for %v", err, logs, m.gotDue, due)
		}
	})
	t.Run("a stale job publishes nothing and succeeds", func(t *testing.T) {
		logs, err := run(t, &marker{}, args)
		if err != nil || strings.Contains(logs, "task due reminder") {
			t.Fatalf("Work = %v, logs %q; want a silent skip", err, logs)
		}
	})
	t.Run("not found is not an error", func(t *testing.T) {
		if _, err := run(t, &marker{err: sharederrors.NotFound("x", "gone")}, args); err != nil {
			t.Fatalf("Work = %v", err)
		}
	})
	t.Run("a database failure is retried", func(t *testing.T) {
		if _, err := run(t, &marker{err: sharederrors.Wrap("x", context.DeadlineExceeded)}, args); err == nil {
			t.Fatal("Work swallowed an infrastructure error")
		}
	})
	t.Run("malformed ids cancel the job", func(t *testing.T) {
		_, err := run(t, &marker{}, jobs.DueReminderArgs{TaskID: "x", UserID: userID.String()})
		var cancel *rivertype.JobCancelError
		if !errors.As(err, &cancel) {
			t.Fatalf("err = %v, want a JobCancel (retrying cannot fix a bad id)", err)
		}
	})
}

func TestDueReminderArgs_ScheduledLeadBeforeDueAndUnique(t *testing.T) {
	opts := jobs.DueReminderArgs{TaskID: "t", DueDate: 1_900_000_000}.InsertOpts()
	if opts.ScheduledAt.Unix() != 1_900_000_000 {
		t.Errorf("ScheduledAt = %v, want the due date without a lead", opts.ScheduledAt)
	}
	opts = jobs.DueReminderArgs{TaskID: "t", DueDate: 1_900_000_000, LeadSeconds: 3600}.InsertOpts()
	if opts.ScheduledAt.Unix() != 1_900_000_000-3600 {
		t.Errorf("ScheduledAt = %v, want one hour before the due date", opts.ScheduledAt)
	}
	if !opts.UniqueOpts.ByArgs {
		t.Error("reminders must be unique by (task, due date) so re-saving a task adds no duplicate job")
	}
}
