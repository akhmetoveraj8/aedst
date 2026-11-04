//go:build integration

// Integration tests against a real PostgreSQL container — see
// docs/content/server/database.md. Run with
// `go test -tags=integration ./internal/modules/tasks/...` (or
// `task test:integration`); skipped by the default `go test ./...`.
package postgres_test

import (
	"context"
	"encoding/json"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/aedst/server/internal/modules/tasks/api"
	"github.com/aedst/server/internal/modules/tasks/application"
	"github.com/aedst/server/internal/modules/tasks/domain"
	"github.com/aedst/server/internal/modules/tasks/infrastructure/postgres"
	"github.com/aedst/server/internal/platform/events"
	"github.com/aedst/server/internal/platform/events/eventstest"
	"github.com/aedst/server/internal/platform/postgrestest"
	sharederrors "github.com/aedst/server/internal/shared/errors"
	"github.com/aedst/server/internal/shared/ids"
	sharedtime "github.com/aedst/server/internal/shared/time"
)

// newTestPool starts Postgres with the tasks migrations and River schema.
func newTestPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	return postgrestest.NewPool(t, "tasks")
}

// newPublisher is the real events.Publisher over a River client on pool (as in
// cmd/server), with a capturing consumer per task event so every published
// event is observable as a delivery job (an event nobody consumes writes
// nothing).
func newPublisher(t *testing.T, pool *pgxpool.Pool) events.Publisher {
	t.Helper()
	return eventstest.New(t, pool).Capture(
		api.TaskCreatedEventType, api.TaskUpdatedEventType, api.TaskDeletedEventType,
		api.TaskCompletedEventType, api.TaskDueSoonEventType,
	).Publisher
}

// newRepository wires a Repository with the real publisher, matching how
// cmd/server constructs one.
func newRepository(t *testing.T, pool *pgxpool.Pool) *postgres.Repository {
	t.Helper()
	return postgres.NewRepository(pool, newPublisher(t, pool), sharedtime.Real{})
}

// completedDeliveries counts TaskCompleted deliveries (one capturing consumer).
func completedDeliveries(t *testing.T, pool *pgxpool.Pool) int {
	t.Helper()
	got, err := eventstest.Deliveries(context.Background(), pool, api.TaskCompletedEventType)
	if err != nil {
		t.Fatalf("read deliveries: %v", err)
	}
	return len(got)
}

func TestRepository_CreateAndFind(t *testing.T) {
	pool := newTestPool(t)
	repo := newRepository(t, pool)
	ctx := context.Background()

	userID := ids.New()
	now := time.Now().UTC().Truncate(time.Second)
	created, err := repo.Create(ctx, domain.Task{
		ID:        ids.New(),
		UserID:    userID,
		Title:     "Write integration test",
		Status:    domain.StatusTodo,
		Priority:  domain.PriorityHigh,
		CreatedAt: now,
		UpdatedAt: now,
	}, "")
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}

	found, err := repo.FindByIDAndUserID(ctx, created.ID, userID)
	if err != nil {
		t.Fatalf("FindByIDAndUserID() error = %v", err)
	}
	if found.Title != "Write integration test" {
		t.Errorf("FindByIDAndUserID() title = %q, want %q", found.Title, "Write integration test")
	}
}

func TestRepository_FindByIDAndUserID_CrossUserIsNotFound(t *testing.T) {
	pool := newTestPool(t)
	repo := newRepository(t, pool)
	ctx := context.Background()

	owner := ids.New()
	now := time.Now().UTC()
	task, err := repo.Create(ctx, domain.Task{
		ID: ids.New(), UserID: owner, Title: "Owner's task",
		Status: domain.StatusTodo, Priority: domain.PriorityLow,
		CreatedAt: now, UpdatedAt: now,
	}, "")
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}

	_, err = repo.FindByIDAndUserID(ctx, task.ID, ids.New())
	if sharederrors.KindOf(err) != sharederrors.KindNotFound {
		t.Fatalf("cross-user FindByIDAndUserID() = %v, want KindNotFound", err)
	}
}

func TestRepository_ListAndStats(t *testing.T) {
	pool := newTestPool(t)
	repo := newRepository(t, pool)
	ctx := context.Background()

	userID := ids.New()
	now := time.Now().UTC()
	seed := []domain.Task{
		{ID: ids.New(), UserID: userID, Title: "todo-1", Status: domain.StatusTodo, Priority: domain.PriorityLow, CreatedAt: now, UpdatedAt: now},
		{ID: ids.New(), UserID: userID, Title: "in-progress-1", Status: domain.StatusTodo, Priority: domain.PriorityMedium, CreatedAt: now.Add(time.Second), UpdatedAt: now},
	}
	for i := range seed {
		created, err := repo.Create(ctx, seed[i], "")
		if err != nil {
			t.Fatalf("seed Create() #%d error = %v", i, err)
		}
		seed[i] = created
	}

	completed, err := repo.Complete(ctx, seed[1].ID, userID, now)
	if err != nil {
		t.Fatalf("Complete() error = %v", err)
	}
	if completed.Status != domain.StatusDone {
		t.Errorf("Complete() status = %v, want StatusDone", completed.Status)
	}

	res, err := repo.List(ctx, application.ListParams{
		UserID: userID, SortBy: "created_at", SortDirection: "desc", Limit: 10,
	})
	if err != nil {
		t.Fatalf("List() error = %v", err)
	}
	if res.Total != 2 || len(res.Tasks) != 2 || res.Next != nil {
		t.Fatalf("List() = %d tasks (total %d, next %v), want 2 and no next page", len(res.Tasks), res.Total, res.Next)
	}
	if res.Tasks[0].Title != "in-progress-1" {
		t.Errorf("List() sort order = %q first, want most-recently-created first", res.Tasks[0].Title)
	}

	stats, err := repo.Stats(ctx, userID)
	if err != nil {
		t.Fatalf("Stats() error = %v", err)
	}
	if stats.Total != 2 || stats.Todo != 1 || stats.Done != 1 {
		t.Errorf("Stats() = %+v, want {Total:2 Todo:1 Done:1 ...}", stats)
	}
}

func TestRepository_Delete(t *testing.T) {
	pool := newTestPool(t)
	repo := newRepository(t, pool)
	ctx := context.Background()

	userID := ids.New()
	now := time.Now().UTC()
	task, err := repo.Create(ctx, domain.Task{
		ID: ids.New(), UserID: userID, Title: "to delete",
		Status: domain.StatusTodo, Priority: domain.PriorityLow,
		CreatedAt: now, UpdatedAt: now,
	}, "")
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}

	if err := repo.Delete(ctx, task.ID, userID, ""); err != nil {
		t.Fatalf("Delete() error = %v", err)
	}

	_, err = repo.FindByIDAndUserID(ctx, task.ID, userID)
	if sharederrors.KindOf(err) != sharederrors.KindNotFound {
		t.Fatalf("FindByIDAndUserID() after delete = %v, want KindNotFound", err)
	}

	if err := repo.Delete(ctx, task.ID, userID, ""); sharederrors.KindOf(err) != sharederrors.KindNotFound {
		t.Fatalf("second Delete() = %v, want KindNotFound", err)
	}
}

// TestRepository_Create_IdempotentReplay proves Create's idempotency
// integration: the same key with the same input returns the original task
// (no duplicate row), and a different input under the same key is rejected
// as a conflict — see internal/platform/idempotency.
func TestRepository_Create_IdempotentReplay(t *testing.T) {
	pool := newTestPool(t)
	repo := newRepository(t, pool)
	ctx := context.Background()

	userID := ids.New()
	now := time.Now().UTC().Truncate(time.Second)
	task := domain.Task{
		ID: ids.New(), UserID: userID, Title: "Idempotent task",
		Status: domain.StatusTodo, Priority: domain.PriorityLow,
		CreatedAt: now, UpdatedAt: now,
	}

	first, err := repo.Create(ctx, task, "retry-key-1")
	if err != nil {
		t.Fatalf("first Create() error = %v", err)
	}

	// A retry generates a fresh domain.Task (new ID/CreatedAt, as
	// application.Service.CreateTask does) but carries the same
	// idempotency key and the same user-facing fields — it must replay the
	// original result, not create a second task.
	retry := task
	retry.ID = ids.New()
	second, err := repo.Create(ctx, retry, "retry-key-1")
	if err != nil {
		t.Fatalf("replayed Create() error = %v", err)
	}
	if second.ID != first.ID {
		t.Fatalf("replayed Create() returned a different task: got %s, want %s", second.ID, first.ID)
	}

	listed, err := repo.List(ctx, application.ListParams{UserID: userID, SortBy: "created_at", SortDirection: "desc", Limit: 10})
	if err != nil {
		t.Fatalf("List() error = %v", err)
	}
	if listed.Total != 1 {
		t.Fatalf("List() total = %d, want 1 (replay must not create a duplicate row)", listed.Total)
	}

	conflicting := task
	conflicting.ID = ids.New()
	conflicting.Title = "Different title"
	if _, err := repo.Create(ctx, conflicting, "retry-key-1"); sharederrors.KindOf(err) != sharederrors.KindConflict {
		t.Fatalf("Create() with reused key and different payload = %v, want KindConflict", err)
	}
}

// TestRepository_Complete_EventToConsumer proves the whole pipeline on a real
// database and a real River client: completing a task atomically inserts the
// delivery job (the outbox is river_job), and River runs the subscribed
// consumer with the event's id, key and payload.
func TestRepository_Complete_EventToConsumer(t *testing.T) {
	pool := newTestPool(t)
	rt := eventstest.Start(t, pool)
	repo := postgres.NewRepository(pool, rt.Publisher, sharedtime.Real{})
	ctx := context.Background()

	var (
		mu        sync.Mutex
		delivered []events.Event
	)
	rt.Registry.Subscribe(api.TaskCompletedEventType, "test.completed", func(_ context.Context, e events.Event) error {
		mu.Lock()
		defer mu.Unlock()
		delivered = append(delivered, e)
		return nil
	})

	userID := ids.New()
	now := time.Now().UTC().Truncate(time.Second)
	created, err := repo.Create(ctx, domain.Task{
		ID: ids.New(), UserID: userID, Title: "Complete me",
		Status: domain.StatusTodo, Priority: domain.PriorityLow,
		CreatedAt: now, UpdatedAt: now,
	}, "")
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	if _, err := repo.Complete(ctx, created.ID, userID, now); err != nil {
		t.Fatalf("Complete() error = %v", err)
	}

	jobs, err := eventstest.Deliveries(ctx, pool, api.TaskCompletedEventType)
	if err != nil || len(jobs) != 1 {
		t.Fatalf("TaskCompleted deliveries = %d, %v; want exactly one", len(jobs), err)
	}
	if jobs[0].PartitionKey != created.ID.String() || jobs[0].Consumer != "test.completed" {
		t.Fatalf("delivery = %+v, want consumer test.completed for task %s", jobs[0], created.ID)
	}

	deadline := time.Now().Add(20 * time.Second)
	for {
		mu.Lock()
		n := len(delivered)
		mu.Unlock()
		if n == 1 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("consumer was not run by River")
		}
		time.Sleep(50 * time.Millisecond)
	}
	mu.Lock()
	defer mu.Unlock()
	var payload api.TaskCompletedEvent
	if err := json.Unmarshal(delivered[0].Payload, &payload); err != nil || payload.Title != "Complete me" || payload.UserID != userID.String() {
		t.Fatalf("payload = %+v (err %v), want the completed task's title and owner", payload, err)
	}
	if delivered[0].ID.String() != jobs[0].EventID || delivered[0].PartitionKey != created.ID || delivered[0].Type != api.TaskCompletedEventType {
		t.Fatalf("event = %+v, want id %s key %s", delivered[0], jobs[0].EventID, created.ID)
	}
}

func TestRepository_Complete_NotFoundWritesNothing(t *testing.T) {
	pool := newTestPool(t)
	repo := newRepository(t, pool)
	ctx := context.Background()

	if _, err := repo.Complete(ctx, ids.New(), ids.New(), time.Now()); sharederrors.KindOf(err) != sharederrors.KindNotFound {
		t.Fatalf("Complete() of a missing task = %v, want KindNotFound", err)
	}
	if n := completedDeliveries(t, pool); n != 0 {
		t.Fatalf("TaskCompleted deliveries = %d, want 0", n)
	}
}

// walk pages through every task matching params with a page size of pageSize
// and returns the titles in the order served, asserting the cursor contract
// on the way: no duplicates, total only on the first page.
func walk(t *testing.T, repo *postgres.Repository, params application.ListParams, pageSize int) []string {
	t.Helper()
	params.Limit = pageSize
	var titles []string
	seen := map[ids.ID]bool{}
	for page := 0; ; page++ {
		res, err := repo.List(context.Background(), params)
		if err != nil {
			t.Fatalf("List() page %d error = %v", page, err)
		}
		if page > 0 && res.Total != 0 {
			t.Errorf("page %d: Total = %d, want 0 (counted on the first page only)", page, res.Total)
		}
		for _, task := range res.Tasks {
			if seen[task.ID] {
				t.Fatalf("task %q served twice", task.Title)
			}
			seen[task.ID] = true
			titles = append(titles, task.Title)
		}
		if res.Next == nil {
			return titles
		}
		params.After = res.Next
		if page > 100 {
			t.Fatal("pagination did not terminate")
		}
	}
}

func TestRepository_ListKeysetPagination(t *testing.T) {
	pool := newTestPool(t)
	repo := newRepository(t, pool)
	ctx := context.Background()

	userID, otherUser := ids.New(), ids.New()
	base := time.Now().UTC().Truncate(time.Microsecond)
	// 7 tasks: created 1s apart; every other one has a due date; two share a
	// created_at (id must break the tie); one title contains a LIKE wildcard.
	type seed struct {
		title string
		due   *time.Time
		at    time.Time
	}
	due := func(d int) *time.Time { v := base.Add(time.Duration(d) * time.Hour); return &v }
	seeds := []seed{
		{"t0", nil, base},
		{"t1", due(5), base.Add(time.Second)},
		{"t2", nil, base.Add(2 * time.Second)},
		{"t3", due(1), base.Add(3 * time.Second)},
		{"t4-100%", nil, base.Add(4 * time.Second)},
		{"t5", due(3), base.Add(4 * time.Second)},
		{"t6", nil, base.Add(6 * time.Second)},
	}
	for _, s := range seeds {
		if _, err := repo.Create(ctx, domain.Task{ID: ids.New(), UserID: userID, Title: s.title, Status: domain.StatusTodo, Priority: domain.PriorityLow, DueDate: s.due, CreatedAt: s.at, UpdatedAt: s.at}, ""); err != nil {
			t.Fatalf("seed %s: %v", s.title, err)
		}
	}
	// Another user's task must never appear.
	if _, err := repo.Create(ctx, domain.Task{ID: ids.New(), UserID: otherUser, Title: "other", Status: domain.StatusTodo, Priority: domain.PriorityLow, CreatedAt: base, UpdatedAt: base}, ""); err != nil {
		t.Fatalf("seed other: %v", err)
	}

	first, err := repo.List(ctx, application.ListParams{UserID: userID, SortBy: "created_at", SortDirection: "desc", Limit: 3})
	if err != nil {
		t.Fatalf("List() error = %v", err)
	}
	if first.Total != 7 || len(first.Tasks) != 3 || first.Next == nil {
		t.Fatalf("first page = %d tasks, total %d, next %v; want 3, 7, non-nil", len(first.Tasks), first.Total, first.Next)
	}

	for pageSize := 1; pageSize <= 8; pageSize++ {
		desc := walk(t, repo, application.ListParams{UserID: userID, SortBy: "created_at", SortDirection: "desc"}, pageSize)
		asc := walk(t, repo, application.ListParams{UserID: userID, SortBy: "created_at", SortDirection: "asc"}, pageSize)
		if len(desc) != 7 || len(asc) != 7 {
			t.Fatalf("pageSize %d: walked %d desc / %d asc tasks, want 7 each", pageSize, len(desc), len(asc))
		}
		for i := range desc {
			if desc[i] != asc[len(asc)-1-i] {
				t.Fatalf("pageSize %d: desc %v is not the reverse of asc %v", pageSize, desc, asc)
			}
		}
		// The page size must never change the order served.
		if pageSize > 1 {
			ref := walk(t, repo, application.ListParams{UserID: userID, SortBy: "created_at", SortDirection: "desc"}, 1)
			for i := range desc {
				if desc[i] != ref[i] {
					t.Fatalf("pageSize %d changed the order: %v vs %v", pageSize, desc, ref)
				}
			}
		}
	}

	// Due-date ordering: tasks without a due date sort first ascending and
	// last descending, as they did before keyset pagination.
	dueAsc := walk(t, repo, application.ListParams{UserID: userID, SortBy: "due_date", SortDirection: "asc"}, 2)
	dueDesc := walk(t, repo, application.ListParams{UserID: userID, SortBy: "due_date", SortDirection: "desc"}, 2)
	if len(dueAsc) != 7 || len(dueDesc) != 7 {
		t.Fatalf("due walk sizes %d/%d, want 7", len(dueAsc), len(dueDesc))
	}
	wantDueTail := []string{"t3", "t5", "t1"} // due in 1h, 3h, 5h
	if got := dueAsc[4:]; got[0] != wantDueTail[0] || got[1] != wantDueTail[1] || got[2] != wantDueTail[2] {
		t.Errorf("due asc tail = %v, want %v", got, wantDueTail)
	}
	if got := dueDesc[:3]; got[0] != "t1" || got[1] != "t5" || got[2] != "t3" {
		t.Errorf("due desc head = %v, want [t1 t5 t3]", got)
	}

	// Search matches literally: "%" is not a wildcard.
	res, err := repo.List(ctx, application.ListParams{UserID: userID, Search: "100%", SortBy: "created_at", SortDirection: "desc", Limit: 10})
	if err != nil {
		t.Fatalf("List(search) error = %v", err)
	}
	if res.Total != 1 || len(res.Tasks) != 1 || res.Tasks[0].Title != "t4-100%" {
		t.Errorf("search \"100%%\" = %+v, want only t4-100%%", res)
	}
	res, err = repo.List(ctx, application.ListParams{UserID: userID, Search: "%", SortBy: "created_at", SortDirection: "desc", Limit: 10})
	if err != nil {
		t.Fatalf("List(search %%) error = %v", err)
	}
	if res.Total != 1 {
		t.Errorf("search \"%%\" matched %d tasks, want 1 (literal percent, not a wildcard)", res.Total)
	}
}
