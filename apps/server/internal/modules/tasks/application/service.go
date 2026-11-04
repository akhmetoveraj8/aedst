package application

import (
	"context"
	"time"

	"github.com/aedst/server/internal/modules/tasks/domain"
	"github.com/aedst/server/internal/shared/ids"
	sharedtime "github.com/aedst/server/internal/shared/time"
)

const (
	defaultPageSize = 20
	maxPageSize     = 100
)

type Service struct {
	repo  Repository
	clock sharedtime.Clock
}

func NewService(repo Repository, clock sharedtime.Clock) *Service {
	return &Service{repo: repo, clock: clock}
}

// CreateTask validates through the domain, then persists. The due-date
// reminder job is enqueued by the repository in the same transaction as the
// insert, so it cannot be lost between commit and enqueue.
func (s *Service) CreateTask(ctx context.Context, userID ids.ID, title, description string, priority domain.Priority, dueDate *time.Time, idempotencyKey string) (domain.Task, error) {
	task, err := domain.NewTask(ids.New(), userID, title, description, priority, dueDate, s.clock.Now())
	if err != nil {
		return domain.Task{}, err
	}
	return s.repo.Create(ctx, task, idempotencyKey)
}

// GetTask returns NotFound (never PermissionDenied) when id belongs to
// another user. Nothing here ever takes a user id from the client — the only
// way to even attempt reaching another user's task is to guess a UUID, and the
// repository query scopes by the authenticated user's id already. Reporting
// NotFound rather than PermissionDenied avoids confirming to an unauthorized
// caller that the id they guessed exists at all (OWASP: prefer 404 over 403
// for object-level access checks).
func (s *Service) GetTask(ctx context.Context, userID, id ids.ID) (domain.Task, error) {
	return s.repo.FindByIDAndUserID(ctx, id, userID)
}

func (s *Service) ListTasks(ctx context.Context, params ListParams) (ListResult, error) {
	if err := params.Normalize(); err != nil {
		return ListResult{}, err
	}
	return s.repo.List(ctx, params)
}

// UpdateTask applies patch in a single statement (no read-modify-write, so
// concurrent edits of different fields cannot overwrite each other). When
// expectedVersion is non-nil the update is rejected with a Conflict unless the
// task is still at that version.
func (s *Service) UpdateTask(ctx context.Context, userID, id ids.ID, patch domain.Patch, expectedVersion *int, idempotencyKey string) (domain.Task, error) {
	if err := patch.Normalize(); err != nil {
		return domain.Task{}, err
	}
	if patch.IsEmpty() {
		return s.repo.FindByIDAndUserID(ctx, id, userID)
	}
	return s.repo.Update(ctx, UpdateParams{
		ID:              id,
		UserID:          userID,
		Patch:           patch,
		ExpectedVersion: expectedVersion,
		UpdatedAt:       s.clock.Now(),
		IdempotencyKey:  idempotencyKey,
	})
}

// DeleteTask deletes in one statement; the repository reports NotFound when
// nothing matched (someone else's or a nonexistent id), so there is no
// pre-read.
func (s *Service) DeleteTask(ctx context.Context, userID, id ids.ID, idempotencyKey string) error {
	return s.repo.Delete(ctx, id, userID, idempotencyKey)
}

// CompleteTask is idempotent: completing a task that is already done returns it
// unchanged and emits no second TaskCompleted event.
func (s *Service) CompleteTask(ctx context.Context, userID, id ids.ID) (domain.Task, error) {
	return s.repo.Complete(ctx, id, userID, s.clock.Now())
}

// ReopenTask is idempotent in the same way.
func (s *Service) ReopenTask(ctx context.Context, userID, id ids.ID) (domain.Task, error) {
	return s.repo.Reopen(ctx, id, userID, s.clock.Now())
}

func (s *Service) GetStats(ctx context.Context, userID ids.ID) (Stats, error) {
	return s.repo.Stats(ctx, userID)
}
