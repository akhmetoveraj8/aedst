// Package application holds the use cases of the tasks module's completion
// feature: completing a task and reopening it. Both are guarded transitions;
// completing publishes TaskCompleted, which other modules consume.
package application

import (
	"context"
	"time"

	"github.com/aedst/server/internal/modules/tasks/domain"
	"github.com/aedst/server/internal/shared/ids"
	sharedtime "github.com/aedst/server/internal/shared/time"
)

type Repository interface {
	// Complete moves id to done and, in the same transaction, writes a
	// TaskCompleted event (see internal/platform/events). Completing an
	// already-done task returns it as-is and writes nothing: the transition,
	// and the event, happen at most once.
	Complete(ctx context.Context, id, userID ids.ID, now time.Time) (domain.Task, error)
	// Reopen moves id back to todo; a no-op when it already is.
	Reopen(ctx context.Context, id, userID ids.ID, now time.Time) (domain.Task, error)
}

type Service struct {
	repo  Repository
	clock sharedtime.Clock
}

func NewService(repo Repository, clock sharedtime.Clock) *Service {
	return &Service{repo: repo, clock: clock}
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
