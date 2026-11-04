package application_test

import (
	"context"
	"testing"
	"time"

	"github.com/aedst/server/internal/modules/tasks/application"
	"github.com/aedst/server/internal/modules/tasks/domain"
	sharederrors "github.com/aedst/server/internal/shared/errors"
	"github.com/aedst/server/internal/shared/ids"
	sharedtime "github.com/aedst/server/internal/shared/time"
)

// fakeRepository is an in-memory test double for application.Repository,
// demonstrating that use cases are testable without a database (see
// docs/content/server/architecture.md — "Most business logic should be tested without
// infrastructure"). It mirrors the real repository's contract: guarded,
// idempotent transitions and version checks.
type fakeRepository struct {
	byID      map[ids.ID]domain.Task
	lastList  application.ListParams
	lastKey   string
	completed int // transitions that would publish a TaskCompleted event
	updates   int
}

func newFakeRepository() *fakeRepository {
	return &fakeRepository{byID: map[ids.ID]domain.Task{}}
}

func (f *fakeRepository) Create(_ context.Context, task domain.Task, key string) (domain.Task, error) {
	f.lastKey = key
	f.byID[task.ID] = task
	return task, nil
}

func (f *fakeRepository) FindByIDAndUserID(_ context.Context, id, userID ids.ID) (domain.Task, error) {
	task, ok := f.byID[id]
	if !ok || task.UserID != userID {
		return domain.Task{}, sharederrors.NotFound("fake.FindByIDAndUserID", "task not found")
	}
	return task, nil
}

func (f *fakeRepository) Update(_ context.Context, p application.UpdateParams) (domain.Task, error) {
	task, ok := f.byID[p.ID]
	if !ok || task.UserID != p.UserID {
		return domain.Task{}, sharederrors.NotFound("fake.Update", "task not found")
	}
	if p.ExpectedVersion != nil && *p.ExpectedVersion != task.Version {
		return domain.Task{}, sharederrors.Conflict("fake.Update", "stale version")
	}
	if p.Patch.Title != nil {
		task.Title = *p.Patch.Title
	}
	if p.Patch.Description != nil {
		task.Description = *p.Patch.Description
	}
	if p.Patch.Priority != nil {
		task.Priority = *p.Patch.Priority
	}
	if p.Patch.SetDueDate {
		task.DueDate = p.Patch.DueDate
	}
	task.Version++
	task.UpdatedAt = p.UpdatedAt
	f.byID[p.ID] = task
	f.updates++
	return task, nil
}

func (f *fakeRepository) Complete(ctx context.Context, id, userID ids.ID, now time.Time) (domain.Task, error) {
	task, err := f.FindByIDAndUserID(ctx, id, userID)
	if err != nil || task.Status == domain.StatusDone {
		return task, err
	}
	task.Status, task.CompletedAt, task.UpdatedAt = domain.StatusDone, &now, now
	task.Version++
	f.byID[id] = task
	f.completed++
	return task, nil
}

func (f *fakeRepository) Reopen(ctx context.Context, id, userID ids.ID, now time.Time) (domain.Task, error) {
	task, err := f.FindByIDAndUserID(ctx, id, userID)
	if err != nil || task.Status == domain.StatusTodo {
		return task, err
	}
	task.Status, task.CompletedAt, task.UpdatedAt = domain.StatusTodo, nil, now
	task.Version++
	f.byID[id] = task
	return task, nil
}

func (f *fakeRepository) Delete(_ context.Context, id, userID ids.ID, _ string) error {
	task, ok := f.byID[id]
	if !ok || task.UserID != userID {
		return sharederrors.NotFound("fake.Delete", "task not found")
	}
	delete(f.byID, id)
	return nil
}

func (f *fakeRepository) List(_ context.Context, params application.ListParams) (application.ListResult, error) {
	f.lastList = params
	var matched []domain.Task
	for _, task := range f.byID {
		if task.UserID == params.UserID {
			matched = append(matched, task)
		}
	}
	return application.ListResult{Tasks: matched, Total: len(matched)}, nil
}

func (f *fakeRepository) Stats(_ context.Context, userID ids.ID) (application.Stats, error) {
	var stats application.Stats
	for _, task := range f.byID {
		if task.UserID != userID {
			continue
		}
		stats.Total++
		switch task.Status {
		case domain.StatusTodo:
			stats.Todo++
		case domain.StatusInProgress:
			stats.InProgress++
		case domain.StatusDone:
			stats.Done++
		}
		if task.IsOverdue(time.Now()) {
			stats.Overdue++
		}
	}
	return stats, nil
}

func newService(repo *fakeRepository) *application.Service {
	return application.NewService(repo, sharedtime.Fixed{At: time.Now()})
}

func TestService_CreateTask(t *testing.T) {
	repo := newFakeRepository()
	svc := newService(repo)

	userID := ids.New()
	due := time.Now().Add(24 * time.Hour)
	task, err := svc.CreateTask(context.Background(), userID, "  Fix bug  ", "details", domain.PriorityHigh, &due, "key-1")
	if err != nil {
		t.Fatalf("CreateTask() error = %v", err)
	}
	if task.Title != "Fix bug" {
		t.Errorf("CreateTask() did not trim title, got %q", task.Title)
	}
	if task.Status != domain.StatusTodo || task.Version != 1 {
		t.Errorf("CreateTask() = status %v version %d, want todo v1", task.Status, task.Version)
	}
	if task.UserID != userID {
		t.Errorf("CreateTask() userID = %v, want %v", task.UserID, userID)
	}
	if repo.lastKey != "key-1" {
		t.Errorf("idempotency key not passed to the repository, got %q", repo.lastKey)
	}
}

// The domain, not the transport, rejects invalid input, so every entry point
// gets the same guarantees.
func TestService_CreateTask_RejectsInvalidInput(t *testing.T) {
	svc := newService(newFakeRepository())
	for name, tc := range map[string]struct {
		title    string
		priority domain.Priority
	}{
		"blank title":      {"   ", domain.PriorityLow},
		"unknown priority": {"ok", domain.Priority("bogus")},
	} {
		t.Run(name, func(t *testing.T) {
			_, err := svc.CreateTask(context.Background(), ids.New(), tc.title, "", tc.priority, nil, "")
			if sharederrors.KindOf(err) != sharederrors.KindValidation {
				t.Fatalf("CreateTask() = %v, want a Validation error", err)
			}
		})
	}
}

// TestService_GetTask_CrossUserAccessIsNotFound is the authorization test:
// a task created by one user must be invisible to another, reported as
// NotFound (see GetTask's doc comment on why NotFound rather than
// PermissionDenied is the correct response here).
func TestService_GetTask_CrossUserAccessIsNotFound(t *testing.T) {
	svc := newService(newFakeRepository())

	owner := ids.New()
	attacker := ids.New()
	task, err := svc.CreateTask(context.Background(), owner, "Owner's task", "", domain.PriorityMedium, nil, "")
	if err != nil {
		t.Fatalf("CreateTask() error = %v", err)
	}

	if _, err := svc.GetTask(context.Background(), owner, task.ID); err != nil {
		t.Fatalf("owner GetTask() error = %v, want nil", err)
	}

	_, err = svc.GetTask(context.Background(), attacker, task.ID)
	if sharederrors.KindOf(err) != sharederrors.KindNotFound {
		t.Fatalf("attacker GetTask() = %v, want KindNotFound", err)
	}
}

func TestService_UpdateTask_CrossUserAccessIsNotFound(t *testing.T) {
	svc := newService(newFakeRepository())

	owner := ids.New()
	attacker := ids.New()
	task, err := svc.CreateTask(context.Background(), owner, "Owner's task", "", domain.PriorityMedium, nil, "")
	if err != nil {
		t.Fatalf("CreateTask() error = %v", err)
	}

	hijacked := "hijacked"
	_, err = svc.UpdateTask(context.Background(), attacker, task.ID, domain.Patch{Title: &hijacked}, nil, "")
	if sharederrors.KindOf(err) != sharederrors.KindNotFound {
		t.Fatalf("attacker UpdateTask() = %v, want KindNotFound", err)
	}

	unchanged, err := svc.GetTask(context.Background(), owner, task.ID)
	if err != nil {
		t.Fatalf("GetTask() after attempted hijack: %v", err)
	}
	if unchanged.Title != "Owner's task" {
		t.Errorf("attacker's UpdateTask mutated the task: title = %q", unchanged.Title)
	}
}

func TestService_UpdateTask_PatchAndVersion(t *testing.T) {
	repo := newFakeRepository()
	svc := newService(repo)
	ctx := context.Background()
	owner := ids.New()
	task, _ := svc.CreateTask(ctx, owner, "Title", "desc", domain.PriorityLow, nil, "")

	title := "  New title  "
	updated, err := svc.UpdateTask(ctx, owner, task.ID, domain.Patch{Title: &title}, nil, "")
	if err != nil {
		t.Fatalf("UpdateTask() error = %v", err)
	}
	if updated.Title != "New title" || updated.Description != "desc" {
		t.Errorf("UpdateTask() = %+v, want only the (trimmed) title changed", updated)
	}

	stale := task.Version
	if _, err := svc.UpdateTask(ctx, owner, task.ID, domain.Patch{Title: &title}, &stale, ""); sharederrors.KindOf(err) != sharederrors.KindConflict {
		t.Fatalf("UpdateTask() with a stale version = %v, want KindConflict", err)
	}

	blank := " "
	if _, err := svc.UpdateTask(ctx, owner, task.ID, domain.Patch{Title: &blank}, nil, ""); sharederrors.KindOf(err) != sharederrors.KindValidation {
		t.Fatalf("UpdateTask() with a blank title = %v, want KindValidation", err)
	}

	before := repo.updates
	same, err := svc.UpdateTask(ctx, owner, task.ID, domain.Patch{}, nil, "")
	if err != nil || repo.updates != before || same.ID != task.ID {
		t.Fatalf("empty patch = %v (updates %d -> %d); want a plain read with no write", err, before, repo.updates)
	}
}

func TestService_DeleteTask_CrossUserAccessIsNotFound(t *testing.T) {
	svc := newService(newFakeRepository())

	owner := ids.New()
	attacker := ids.New()
	task, err := svc.CreateTask(context.Background(), owner, "Owner's task", "", domain.PriorityMedium, nil, "")
	if err != nil {
		t.Fatalf("CreateTask() error = %v", err)
	}

	if err := svc.DeleteTask(context.Background(), attacker, task.ID, ""); sharederrors.KindOf(err) != sharederrors.KindNotFound {
		t.Fatalf("attacker DeleteTask() = %v, want KindNotFound", err)
	}
	if _, err := svc.GetTask(context.Background(), owner, task.ID); err != nil {
		t.Fatalf("task should still exist after attacker's failed delete, GetTask() error = %v", err)
	}
}

func TestService_CompleteTask_IsIdempotent_ThenReopen(t *testing.T) {
	repo := newFakeRepository()
	svc := newService(repo)

	userID := ids.New()
	task, err := svc.CreateTask(context.Background(), userID, "Task", "", domain.PriorityLow, nil, "")
	if err != nil {
		t.Fatalf("CreateTask() error = %v", err)
	}

	completed, err := svc.CompleteTask(context.Background(), userID, task.ID)
	if err != nil {
		t.Fatalf("CompleteTask() error = %v", err)
	}
	if completed.Status != domain.StatusDone || completed.CompletedAt == nil {
		t.Errorf("CompleteTask() = %+v, want done with completed_at", completed)
	}
	again, err := svc.CompleteTask(context.Background(), userID, task.ID)
	if err != nil || again.Version != completed.Version {
		t.Fatalf("second CompleteTask() = version %d, %v; want unchanged", again.Version, err)
	}
	if repo.completed != 1 {
		t.Errorf("completion transitions = %d, want 1 (one event, not one per call)", repo.completed)
	}

	reopened, err := svc.ReopenTask(context.Background(), userID, task.ID)
	if err != nil {
		t.Fatalf("ReopenTask() error = %v", err)
	}
	if reopened.Status != domain.StatusTodo || reopened.CompletedAt != nil {
		t.Errorf("ReopenTask() = %+v, want todo without completed_at", reopened)
	}
}

func TestService_ListTasks_DefaultsPageSize(t *testing.T) {
	repo := newFakeRepository()
	svc := newService(repo)

	userID := ids.New()
	for i := range 3 {
		if _, err := svc.CreateTask(context.Background(), userID, "Task", "", domain.PriorityLow, nil, ""); err != nil {
			t.Fatalf("CreateTask() #%d error = %v", i, err)
		}
	}

	res, err := svc.ListTasks(context.Background(), application.ListParams{UserID: userID})
	if err != nil {
		t.Fatalf("ListTasks() error = %v", err)
	}
	if res.Total != 3 || len(res.Tasks) != 3 {
		t.Errorf("ListTasks() = %d tasks (total %d), want 3", len(res.Tasks), res.Total)
	}
	if got := repo.lastList; got.Limit != 20 || got.SortBy != "created_at" || got.SortDirection != "desc" {
		t.Errorf("repository saw params %+v, want defaults limit=20 created_at desc", got)
	}

	if _, err := svc.ListTasks(context.Background(), application.ListParams{UserID: userID, Limit: 10_000}); err != nil {
		t.Fatalf("ListTasks() error = %v", err)
	}
	if repo.lastList.Limit != 100 {
		t.Errorf("repository saw limit %d, want it clamped to 100", repo.lastList.Limit)
	}

	res, err = svc.ListTasks(context.Background(), application.ListParams{UserID: ids.New()})
	if err != nil {
		t.Fatalf("ListTasks() for other user error = %v", err)
	}
	if len(res.Tasks) != 0 {
		t.Errorf("ListTasks() leaked another user's tasks: got %d", len(res.Tasks))
	}
}
