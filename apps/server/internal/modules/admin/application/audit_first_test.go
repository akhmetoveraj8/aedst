package application_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/aedst/server/internal/modules/admin/application"
	"github.com/aedst/server/internal/modules/admin/domain"
	notificationsapi "github.com/aedst/server/internal/modules/notifications/api"
	tasksapi "github.com/aedst/server/internal/modules/tasks/api"
	sharederrors "github.com/aedst/server/internal/shared/errors"
	"github.com/aedst/server/internal/shared/ids"
	sharedtime "github.com/aedst/server/internal/shared/time"
)

// The audit store of the audit-first path, extending the fake of service_test.go.
// Not integration-tested: the SQL (InsertPendingAuditEntry, ResolveAuditEntry) and the
// database trigger need Postgres; these tests pin the application behaviour only.

func (a *audit) InsertPendingTx(_ context.Context, _ pgx.Tx, e domain.AuditEntry) error {
	e.State = domain.StatePending
	a.entries = append(a.entries, e)
	return nil
}

func (a *audit) Get(_ context.Context, id ids.ID) (domain.AuditEntry, error) {
	for _, e := range a.entries {
		if e.ID == id {
			return e, nil
		}
	}
	return domain.AuditEntry{}, sharederrors.NotFound("test", "no entry")
}

func (a *audit) Resolve(_ context.Context, id ids.ID, state domain.State, failure string, result map[string]any, _ time.Time) (bool, error) {
	for i, e := range a.entries {
		if e.ID == id && e.State == domain.StatePending {
			a.entries[i].State, a.entries[i].Failure = state, failure
			a.results = append(a.results, result)
			return true, nil
		}
	}
	return false, nil
}

type queue struct{ enqueued []ids.ID }

func (q *queue) EnqueueApplyTx(_ context.Context, _ pgx.Tx, id ids.ID) error {
	q.enqueued = append(q.enqueued, id)
	return nil
}

// remoteTasks is the network client of tasks: DeleteTask is idempotent on its key,
// like the owner's.
type remoteTasks struct {
	unavailable error
	err         error
	owner       ids.ID
	keys        []string
}

func (r *remoteTasks) Available() error { return r.unavailable }

func (r *remoteTasks) DeleteTask(_ context.Context, key string, _ ids.ID) (ids.ID, error) {
	r.keys = append(r.keys, key)
	return r.owner, r.err
}

type remoteNotifications struct {
	err  error
	keys []string
	got  []notificationsapi.Broadcast
}

func (r *remoteNotifications) BroadcastIdempotent(_ context.Context, key string, _ *ids.ID, b notificationsapi.Broadcast) (int64, error) {
	r.keys, r.got = append(r.keys, key), append(r.got, b)
	return 9, r.err
}
func (r *remoteNotifications) CountActiveDevices(context.Context) (int64, error) { return 0, nil }

func auditFirstSetup(rt *remoteTasks, rn *remoteNotifications) (*application.Service, *audit, *queue, *tasks) {
	a, q, tk := &audit{}, &queue{}, &tasks{owner: ids.New()}
	deps := application.Deps{
		Tasks: tk, Notifications: &notifier{}, Platform: platform{}, Audit: a, Tx: &tx{audit: a}, Queue: q,
		Clock: sharedtime.Fixed{At: time.Now()},
	}
	if rt != nil {
		deps.TasksOps = rt
	}
	if rn != nil {
		deps.NotificationsOps = rn
	}
	return application.NewService(deps), a, q, tk
}

func TestDeleteTask_AuditFirstWritesPendingEntryAndJobTogether(t *testing.T) {
	svc, a, q, tk := auditFirstSetup(&remoteTasks{}, nil)
	task := ids.New()

	if err := svc.DeleteTask(context.Background(), domain.Actor{UserID: ids.New()}, task, "spam report #42"); err != nil {
		t.Fatal(err)
	}
	if len(a.entries) != 1 || a.entries[0].State != domain.StatePending || a.entries[0].TargetID != task.String() {
		t.Fatalf("entries = %+v, want one pending entry for the task", a.entries)
	}
	if len(q.enqueued) != 1 || q.enqueued[0] != a.entries[0].ID {
		t.Fatalf("enqueued = %v, want the entry's id", q.enqueued)
	}
	if tk.deleteErr != nil {
		t.Fatal("setup")
	}
}

func TestDeleteTask_AuditFirstRefusesWhenTheRemoteCannotAct(t *testing.T) {
	svc, a, q, _ := auditFirstSetup(&remoteTasks{unavailable: sharederrors.FailedPrecondition("remote", "no service identity")}, nil)
	err := svc.DeleteTask(context.Background(), domain.Actor{}, ids.New(), "spam report #42")
	if sharederrors.KindOf(err) != sharederrors.KindFailedPrecondition {
		t.Fatalf("err = %v, want FailedPrecondition", err)
	}
	if len(a.entries) != 0 || len(q.enqueued) != 0 {
		t.Fatalf("an action that cannot be applied was queued: %+v", a.entries)
	}
}

func TestBroadcast_AuditFirstValidatesBeforeQueueing(t *testing.T) {
	svc, a, q, _ := auditFirstSetup(nil, &remoteNotifications{})
	if _, err := svc.BroadcastNotification(context.Background(), domain.Actor{}, nil, "  ", "b", ""); sharederrors.KindOf(err) != sharederrors.KindValidation {
		t.Fatalf("err = %v, want Validation", err)
	}
	if len(a.entries) != 0 {
		t.Fatal("an invalid message was queued")
	}
	n, err := svc.BroadcastNotification(context.Background(), domain.Actor{}, nil, " Maintenance ", "tonight", "/status")
	if err != nil || n != 0 {
		t.Fatalf("BroadcastNotification = %d, %v; want 0 recipients (unknown until applied)", n, err)
	}
	if len(a.entries) != 1 || a.entries[0].Metadata["title"] != "Maintenance" || len(q.enqueued) != 1 {
		t.Fatalf("entries = %+v, enqueued = %v", a.entries, q.enqueued)
	}
}

func applier(a *audit, rt *remoteTasks, rn *remoteNotifications) *application.Applier {
	var t tasksapi.OperatorService // an untyped nil keeps "not hosted/configured" distinguishable
	if rt != nil {
		t = rt
	}
	var n notificationsapi.Operator
	if rn != nil {
		n = rn
	}
	return application.NewApplier(a, t, n, sharedtime.Fixed{At: time.Now()})
}

func pendingDelete(a *audit) ids.ID {
	e := domain.AuditEntry{ID: ids.New(), Action: domain.ActionDeleteTask, TargetKind: domain.TargetTask, TargetID: ids.New().String(), State: domain.StatePending}
	a.entries = append(a.entries, e)
	return e.ID
}

func TestApply_AppliesWithTheEntryIDAsIdempotencyKey(t *testing.T) {
	a, rt := &audit{}, &remoteTasks{owner: ids.New()}
	id := pendingDelete(a)

	if err := applier(a, rt, nil).Apply(context.Background(), id, false); err != nil {
		t.Fatal(err)
	}
	if a.entries[0].State != domain.StateApplied || len(rt.keys) != 1 || rt.keys[0] != id.String() {
		t.Fatalf("state %s, keys %v; want applied with key %s", a.entries[0].State, rt.keys, id)
	}
	if a.results[0]["owner_id"] != rt.owner.String() {
		t.Errorf("result = %v", a.results[0])
	}

	// A redelivered job finds it resolved and does nothing.
	if err := applier(a, rt, nil).Apply(context.Background(), id, false); err != nil || len(rt.keys) != 1 {
		t.Fatalf("redelivery: err %v, calls %d; want a no-op", err, len(rt.keys))
	}
}

func TestApply_PermanentErrorFailsTheEntryAndStopsRetrying(t *testing.T) {
	a, rt := &audit{}, &remoteTasks{err: sharederrors.NotFound("tasks", "task not found")}
	id := pendingDelete(a)

	if err := applier(a, rt, nil).Apply(context.Background(), id, false); err != nil {
		t.Fatalf("a permanent failure must not be retried, got %v", err)
	}
	if a.entries[0].State != domain.StateFailed || a.entries[0].Failure != "task not found" {
		t.Fatalf("entry = %+v", a.entries[0])
	}
}

func TestApply_TransientErrorRetriesThenGivesUpOnTheLastAttempt(t *testing.T) {
	a, rt := &audit{}, &remoteTasks{err: sharederrors.Wrap("tasks", errors.New("connection refused"))}
	id := pendingDelete(a)

	if err := applier(a, rt, nil).Apply(context.Background(), id, false); err == nil {
		t.Fatal("a transient failure must be returned so River retries")
	}
	if a.entries[0].State != domain.StatePending {
		t.Fatalf("state = %s, want it still pending", a.entries[0].State)
	}
	if err := applier(a, rt, nil).Apply(context.Background(), id, true); err != nil {
		t.Fatalf("the last attempt resolves instead of retrying, got %v", err)
	}
	if a.entries[0].State != domain.StateFailed {
		t.Fatalf("state = %s, want failed after the last attempt", a.entries[0].State)
	}
}

func TestApply_BroadcastSendsTheStoredMessage(t *testing.T) {
	a, rn := &audit{}, &remoteNotifications{}
	e := domain.AuditEntry{
		ID: ids.New(), Action: domain.ActionBroadcastNotification, TargetKind: domain.TargetAll, State: domain.StatePending,
		Metadata: map[string]any{"title": "Maintenance", "body": "tonight", "link": "/status"},
	}
	a.entries = append(a.entries, e)

	if err := applier(a, nil, rn).Apply(context.Background(), e.ID, false); err != nil {
		t.Fatal(err)
	}
	if len(rn.got) != 1 || rn.got[0] != (notificationsapi.Broadcast{Title: "Maintenance", Body: "tonight", Link: "/status"}) || rn.keys[0] != e.ID.String() {
		t.Fatalf("sent %+v with keys %v", rn.got, rn.keys)
	}
	if a.entries[0].State != domain.StateApplied || a.results[0]["recipients"] != int64(9) {
		t.Fatalf("entry %+v, results %v", a.entries[0], a.results)
	}
}

func TestApply_MissingEntryAndUnknownActionAreNotRetried(t *testing.T) {
	a := &audit{}
	if err := applier(a, &remoteTasks{}, nil).Apply(context.Background(), ids.New(), false); err != nil {
		t.Fatalf("a purged entry: %v", err)
	}
	a.entries = append(a.entries, domain.AuditEntry{ID: ids.New(), Action: "mystery", State: domain.StatePending})
	if err := applier(a, &remoteTasks{}, nil).Apply(context.Background(), a.entries[0].ID, false); err != nil {
		t.Fatalf("an unknown action: %v", err)
	}
	if a.entries[0].State != domain.StateFailed {
		t.Fatalf("state = %s, want failed", a.entries[0].State)
	}
}
