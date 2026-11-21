package application_test

import (
	"context"
	"testing"
	"time"

	"github.com/aedst/server/internal/modules/tasks/domain"
	"github.com/aedst/server/internal/modules/tasks/features/completion/application"
	sharederrors "github.com/aedst/server/internal/shared/errors"
	"github.com/aedst/server/internal/shared/ids"
	sharedtime "github.com/aedst/server/internal/shared/time"
)

// fakeRepository mirrors the real repository's contract: guarded, idempotent
// transitions scoped to the owner.
type fakeRepository struct {
	byID      map[ids.ID]domain.Task
	completed int // transitions that would publish a TaskCompleted event
}

func (f *fakeRepository) find(id, userID ids.ID) (domain.Task, error) {
	task, ok := f.byID[id]
	if !ok || task.UserID != userID {
		return domain.Task{}, sharederrors.NotFound("fake.find", "task not found")
	}
	return task, nil
}

func (f *fakeRepository) Complete(_ context.Context, id, userID ids.ID, now time.Time) (domain.Task, error) {
	task, err := f.find(id, userID)
	if err != nil || task.Status == domain.StatusDone {
		return task, err
	}
	task.Status, task.CompletedAt, task.UpdatedAt = domain.StatusDone, &now, now
	task.Version++
	f.byID[id] = task
	f.completed++
	return task, nil
}

func (f *fakeRepository) Reopen(_ context.Context, id, userID ids.ID, now time.Time) (domain.Task, error) {
	task, err := f.find(id, userID)
	if err != nil || task.Status == domain.StatusTodo {
		return task, err
	}
	task.Status, task.CompletedAt, task.UpdatedAt = domain.StatusTodo, nil, now
	task.Version++
	f.byID[id] = task
	return task, nil
}

func TestService_CompleteTask_IsIdempotent_ThenReopen(t *testing.T) {
	userID := ids.New()
	task, err := domain.NewTask(ids.New(), userID, "Task", "", domain.PriorityLow, nil, time.Now())
	if err != nil {
		t.Fatalf("NewTask() error = %v", err)
	}
	repo := &fakeRepository{byID: map[ids.ID]domain.Task{task.ID: task}}
	svc := application.NewService(repo, sharedtime.Fixed{At: time.Now()})

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

	if _, err := svc.CompleteTask(context.Background(), ids.New(), task.ID); sharederrors.KindOf(err) != sharederrors.KindNotFound {
		t.Fatalf("another user's CompleteTask() = %v, want KindNotFound", err)
	}
}
