// Package application holds the use cases of the tasks module's core feature:
// create, read, list, edit and delete a task, and the owner's counts. It
// depends only on the module's shared domain and the interfaces declared here;
// infrastructure/postgres provides the concrete implementation, keeping this
// package testable without a database or a job queue (see
// docs/content/server/modules.md).
package application

import (
	"context"
	"time"

	"github.com/aedst/server/internal/modules/tasks/domain"
	"github.com/aedst/server/internal/shared/ids"
)

type Repository interface {
	// Create persists task. If idempotencyKey is non-empty, the write is
	// wrapped in an idempotency check (see internal/platform/idempotency) so
	// a client retrying the same CreateTask request after a dropped response
	// gets back the original task instead of a duplicate. Side effects that
	// must not be lost (the due-date reminder job) commit in the same
	// transaction.
	Create(ctx context.Context, task domain.Task, idempotencyKey string) (domain.Task, error)
	FindByIDAndUserID(ctx context.Context, id, userID ids.ID) (domain.Task, error)
	// Update applies params.Patch to title/description/priority/due_date only
	// (see tasks.proto's UpdateTask doc comment on why status is never
	// included) in one atomic statement. It returns a Conflict-kind error
	// when params.ExpectedVersion is set and stale, NotFound when the task is
	// not the caller's.
	Update(ctx context.Context, params UpdateParams) (domain.Task, error)
	// Delete and Update take an optional idempotency key: a retry with the same
	// key replays the first result instead of NotFound/Conflict or a second write.
	Delete(ctx context.Context, id, userID ids.ID, idempotencyKey string) error
	List(ctx context.Context, params domain.ListParams) (domain.ListResult, error)
	Stats(ctx context.Context, userID ids.ID) (domain.Stats, error)
}

// UpdateParams is one partial update of a task.
type UpdateParams struct {
	ID     ids.ID
	UserID ids.ID
	Patch  domain.Patch
	// ExpectedVersion, when non-nil, makes the update conditional on the task
	// still being at that version (optimistic concurrency).
	ExpectedVersion *int
	UpdatedAt       time.Time
	// IdempotencyKey, when non-empty, makes a retry replay the first result.
	IdempotencyKey string
}
