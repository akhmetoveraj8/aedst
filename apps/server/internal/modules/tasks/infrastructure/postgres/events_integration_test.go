//go:build integration

package postgres_test

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/aedst/server/internal/modules/tasks/api"
	"github.com/aedst/server/internal/modules/tasks/application"
	"github.com/aedst/server/internal/modules/tasks/domain"
	"github.com/aedst/server/internal/platform/database"
	"github.com/aedst/server/internal/platform/events/eventstest"
	sharederrors "github.com/aedst/server/internal/shared/errors"
	"github.com/aedst/server/internal/shared/ids"

	"github.com/jackc/pgx/v5"
)

func eventsOf(t *testing.T, ctx context.Context, q eventstest.Querier, taskID ids.ID) []string {
	t.Helper()
	types, err := eventstest.EventTypes(ctx, q, taskID.String())
	if err != nil {
		t.Fatal(err)
	}
	return types
}

// Every state change publishes its snapshot event in the same transaction,
// carrying the version projections order by.
func TestRepository_PublishesCreateUpdateDeleteEvents(t *testing.T) {
	pool := newTestPool(t)
	repo := newRepository(t, pool)
	ctx := context.Background()
	user := ids.New()

	created, err := repo.Create(ctx, newTask(t, user, "Write report"), "")
	if err != nil {
		t.Fatal(err)
	}
	title := "Write the report"
	updated, err := repo.Update(ctx, application.UpdateParams{ID: created.ID, UserID: user, Patch: domain.Patch{Title: &title}, UpdatedAt: time.Now()})
	if err != nil || updated.Version != 2 {
		t.Fatalf("Update = %+v, %v", updated, err)
	}
	if err := repo.Delete(ctx, created.ID, user, ""); err != nil {
		t.Fatal(err)
	}
	got := eventsOf(t, ctx, pool, created.ID)
	want := []string{api.TaskCreatedEventType, api.TaskUpdatedEventType, api.TaskDeletedEventType}
	if len(got) != 3 || got[0] != want[0] || got[1] != want[1] || got[2] != want[2] {
		t.Fatalf("events = %v, want %v", got, want)
	}

	deliveries, err := eventstest.Deliveries(ctx, pool, api.TaskDeletedEventType)
	if err != nil || len(deliveries) != 1 {
		t.Fatalf("TaskDeleted deliveries = %d, %v; want 1", len(deliveries), err)
	}
	raw := deliveries[0].Payload
	var deleted api.TaskDeletedEvent
	if err := json.Unmarshal(raw, &deleted); err != nil || deleted.Version != 3 || deleted.UserID != user.String() {
		t.Errorf("TaskDeleted = %+v, %v; want version 3 (above the last snapshot)", deleted, err)
	}

	// Failed mutations publish nothing.
	if err := repo.Delete(ctx, created.ID, user, ""); sharederrors.KindOf(err) != sharederrors.KindNotFound {
		t.Fatalf("second Delete = %v", err)
	}
	if n := len(eventsOf(t, ctx, pool, created.ID)); n != 3 {
		t.Errorf("events after a failed delete = %d, want 3", n)
	}
}

// TaskDueSoon is published once per (task, due date), only while the task is
// open and still due at that instant.
func TestRepository_MarkDueSoon_IsGuarded(t *testing.T) {
	pool := newTestPool(t)
	repo := newRepository(t, pool)
	ctx := context.Background()
	user := ids.New()
	due := time.Now().Add(time.Hour).UTC().Truncate(time.Second)
	task := newTask(t, user, "Pay rent")
	task.DueDate = &due
	created, err := repo.Create(ctx, task, "")
	if err != nil {
		t.Fatal(err)
	}

	if ok, err := repo.MarkDueSoon(ctx, created.ID, user, due.Add(time.Minute)); err != nil || ok {
		t.Fatalf("a stale due date published: %v, %v", ok, err)
	}
	if ok, err := repo.MarkDueSoon(ctx, created.ID, ids.New(), due); err != nil || ok {
		t.Fatalf("another user's task published: %v, %v", ok, err)
	}
	for i := range 3 {
		ok, err := repo.MarkDueSoon(ctx, created.ID, user, due)
		if err != nil || ok != (i == 0) {
			t.Fatalf("attempt %d: published=%v err=%v; want exactly the first to publish", i, ok, err)
		}
	}
	if _, err := repo.Complete(ctx, created.ID, user, time.Now()); err != nil {
		t.Fatal(err)
	}
	dueDeliveries, _ := eventstest.Deliveries(ctx, pool, api.TaskDueSoonEventType)
	n := len(dueDeliveries)
	if n != 1 {
		t.Errorf("TaskDueSoon rows = %d, want 1", n)
	}
}

func TestRepository_AdminOperations(t *testing.T) {
	pool := newTestPool(t)
	repo := newRepository(t, pool)
	admin := application.NewAdminService(repo)
	ctx := context.Background()
	alice, bob := ids.New(), ids.New()
	for i, owner := range []ids.ID{alice, alice, bob} {
		task := newTask(t, owner, []string{"alpha", "beta", "gamma"}[i])
		task.CreatedAt = task.CreatedAt.Add(time.Duration(i) * time.Millisecond)
		if _, err := repo.Create(ctx, task, ""); err != nil {
			t.Fatal(err)
		}
	}

	page, err := admin.ListAllTasks(ctx, nil, "", 2, nil)
	if err != nil || len(page.Tasks) != 2 || page.Next == nil || page.Tasks[0].Title != "gamma" {
		t.Fatalf("first page = %+v, %v", page, err)
	}
	rest, err := admin.ListAllTasks(ctx, nil, "", 2, page.Next)
	if err != nil || len(rest.Tasks) != 1 || rest.Next != nil || rest.Tasks[0].Title != "alpha" {
		t.Fatalf("second page = %+v, %v", rest, err)
	}
	onlyBob, err := admin.ListAllTasks(ctx, &bob, "", 10, nil)
	if err != nil || len(onlyBob.Tasks) != 1 {
		t.Fatalf("owner filter = %+v, %v", onlyBob, err)
	}
	counts, err := admin.CountByOwners(ctx, []ids.ID{alice, bob, ids.New()})
	if err != nil || counts[alice] != 2 || counts[bob] != 1 {
		t.Fatalf("counts = %v, %v", counts, err)
	}
	stats, err := admin.Stats(ctx)
	if err != nil || stats.Total != 3 {
		t.Fatalf("stats = %+v, %v", stats, err)
	}

	victim := onlyBob.Tasks[0]
	var owner ids.ID
	err = database.WithTx(ctx, pool, func(ctx context.Context, tx pgx.Tx) error {
		var err error
		owner, err = admin.DeleteTaskTx(ctx, tx, victim.ID)
		return err
	})
	if err != nil || owner != bob {
		t.Fatalf("DeleteTaskTx = %s, %v", owner, err)
	}
	if got := eventsOf(t, ctx, pool, victim.ID); got[len(got)-1] != api.TaskDeletedEventType {
		t.Errorf("events = %v, want a trailing TaskDeleted", got)
	}
}
