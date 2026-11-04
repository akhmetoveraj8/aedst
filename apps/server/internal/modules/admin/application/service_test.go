package application_test

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/aedst/server/internal/modules/admin/application"
	"github.com/aedst/server/internal/modules/admin/domain"
	notificationsapi "github.com/aedst/server/internal/modules/notifications/api"
	tasksapi "github.com/aedst/server/internal/modules/tasks/api"
	sharederrors "github.com/aedst/server/internal/shared/errors"
	"github.com/aedst/server/internal/shared/ids"
	"github.com/aedst/server/internal/shared/pagination"
	sharedtime "github.com/aedst/server/internal/shared/time"
)

// tx records whether the work committed: Run "rolls back" (drops the audit
// entries written inside it) when fn fails.
type tx struct {
	audit     *audit
	committed int
}

func (t *tx) Run(ctx context.Context, fn func(context.Context, pgx.Tx) error) error {
	before := len(t.audit.entries)
	if err := fn(ctx, nil); err != nil {
		t.audit.entries = t.audit.entries[:before]
		return err
	}
	t.committed++
	return nil
}

type audit struct{ entries []domain.AuditEntry }

func (a *audit) InsertTx(_ context.Context, _ pgx.Tx, e domain.AuditEntry) error {
	a.entries = append(a.entries, e)
	return nil
}

func (a *audit) List(context.Context, int, *pagination.Cursor) ([]domain.AuditEntry, *pagination.Cursor, error) {
	return a.entries, nil, nil
}

type tasks struct {
	deleteErr error
	owner     ids.ID
}

func (t *tasks) ListAllTasks(context.Context, *ids.ID, string, int32, *pagination.Cursor) (tasksapi.ListResult, error) {
	return tasksapi.ListResult{}, nil
}

func (t *tasks) DeleteTaskTx(context.Context, pgx.Tx, ids.ID) (ids.ID, error) {
	return t.owner, t.deleteErr
}

func (t *tasks) Stats(context.Context) (tasksapi.AdminStats, error) {
	return tasksapi.AdminStats{Total: 10, Done: 4, Overdue: 1}, nil
}

func (t *tasks) CountByOwners(context.Context, []ids.ID) (map[ids.ID]int64, error) {
	return map[ids.ID]int64{}, nil
}

type notifier struct{ got *notificationsapi.Broadcast }

func (n *notifier) BroadcastTx(_ context.Context, _ pgx.Tx, _ *ids.ID, b notificationsapi.Broadcast) (int64, error) {
	if b.Title == "" {
		return 0, sharederrors.Validation("x", "title")
	}
	n.got = &b
	return 3, nil
}
func (n *notifier) CountActiveDevices(context.Context) (int64, error) { return 5, nil }

type platform struct{}

func (platform) JobLag(context.Context) (time.Duration, error) { return 2 * time.Second, nil }
func (platform) PendingJobs(context.Context) (int64, error)    { return 7, nil }

func setup() (*application.Service, *audit, *tx, *tasks, *notifier) {
	a := &audit{}
	t := &tx{audit: a}
	tk := &tasks{owner: ids.New()}
	n := &notifier{}
	svc := application.NewService(application.Deps{Tasks: tk, Notifications: n, Platform: platform{}, Audit: a, Tx: t, Clock: sharedtime.Fixed{At: time.Now()}})
	return svc, a, t, tk, n
}

func TestDeleteTask_AuditsInTheSameTransaction(t *testing.T) {
	svc, a, tx, tk, _ := setup()
	actor := domain.Actor{UserID: ids.New(), Subject: "op"}
	task := ids.New()

	if err := svc.DeleteTask(context.Background(), actor, task, "x"); sharederrors.KindOf(err) != sharederrors.KindValidation {
		t.Fatalf("short reason: %v", err)
	}
	if err := svc.DeleteTask(context.Background(), actor, task, " spam report #42 "); err != nil {
		t.Fatal(err)
	}
	if tx.committed != 1 || len(a.entries) != 1 {
		t.Fatalf("committed %d, entries %d", tx.committed, len(a.entries))
	}
	e := a.entries[0]
	if e.Action != domain.ActionDeleteTask || e.TargetID != task.String() || e.Reason != "spam report #42" || e.Actor != actor || e.Metadata["owner_id"] != tk.owner.String() {
		t.Errorf("entry = %+v", e)
	}

	tk.deleteErr = sharederrors.NotFound("x", "task not found")
	if err := svc.DeleteTask(context.Background(), actor, task, "again please"); sharederrors.KindOf(err) != sharederrors.KindNotFound || len(a.entries) != 1 {
		t.Errorf("a failed delete must not leave an audit entry: %v, %d entries", err, len(a.entries))
	}
}

func TestBroadcast_GoesThroughNotificationsAndIsAudited(t *testing.T) {
	svc, a, _, _, n := setup()
	user := ids.New()
	got, err := svc.BroadcastNotification(context.Background(), domain.Actor{UserID: ids.New()}, &user, "Maintenance", "tonight", "/status")
	if err != nil || got != 3 || n.got == nil || n.got.Link != "/status" {
		t.Fatalf("Broadcast = %d, %v (notifier saw %+v)", got, err, n.got)
	}
	if len(a.entries) != 1 || a.entries[0].TargetKind != domain.TargetUser || a.entries[0].TargetID != user.String() {
		t.Errorf("audit = %+v", a.entries)
	}
	if _, err := svc.BroadcastNotification(context.Background(), domain.Actor{}, nil, "", "", ""); err == nil || len(a.entries) != 1 {
		t.Errorf("an invalid broadcast must fail and leave no entry")
	}
}

func TestOverview(t *testing.T) {
	svc, _, _, _, _ := setup()
	o, err := svc.GetOverview(context.Background())
	if err != nil || o.TasksTotal != 10 || o.PushDevices != 5 || o.JobLagSeconds != 2 || o.JobsPending != 7 {
		t.Fatalf("overview = %+v, %v", o, err)
	}
	if _, err := svc.ListTasks(context.Background(), nil, "", 10, "garbage"); sharederrors.KindOf(err) != sharederrors.KindValidation {
		t.Errorf("bad token: %v", err)
	}
}
