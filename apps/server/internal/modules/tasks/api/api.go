// Package api is the tasks module's public boundary: the only package of
// modules/tasks that cmd/server and other modules may import (enforced by
// architecturetest). It exposes the owner-scoped Service (transport), the
// operator AdminService (admin module), and the integration events in
// events.go (notifications and search consume them).
package api

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/aedst/server/internal/modules/tasks/application"
	"github.com/aedst/server/internal/modules/tasks/domain"
	"github.com/aedst/server/internal/shared/ids"
	"github.com/aedst/server/internal/shared/pagination"
)

type (
	Task       = domain.Task
	Patch      = domain.Patch
	Status     = domain.Status
	Priority   = domain.Priority
	ListParams = application.ListParams
	Stats      = application.Stats
	ListResult = application.ListResult
)

const (
	StatusTodo       = domain.StatusTodo
	StatusInProgress = domain.StatusInProgress
	StatusDone       = domain.StatusDone

	PriorityLow    = domain.PriorityLow
	PriorityMedium = domain.PriorityMedium
	PriorityHigh   = domain.PriorityHigh
	PriorityUrgent = domain.PriorityUrgent
)

// Service is everything a transport handler can do with tasks. It is
// satisfied by *application.Service. Every method takes userID explicitly,
// derived by the caller from the authenticated context — see
// api/proto/aedst/tasks/v1/tasks.proto's service doc comment.
type Service interface {
	// CreateTask persists a new task. idempotencyKey, if non-empty, lets a
	// client-retried request return the originally created task instead of
	// creating a duplicate — see internal/platform/idempotency.
	CreateTask(ctx context.Context, userID ids.ID, title, description string, priority Priority, dueDate *time.Time, idempotencyKey string) (Task, error)
	GetTask(ctx context.Context, userID, id ids.ID) (Task, error)
	ListTasks(ctx context.Context, params ListParams) (ListResult, error)
	// UpdateTask applies patch atomically. A non-nil expectedVersion makes it
	// conditional on the task still being at that version (Conflict otherwise).
	UpdateTask(ctx context.Context, userID, id ids.ID, patch Patch, expectedVersion *int, idempotencyKey string) (Task, error)
	DeleteTask(ctx context.Context, userID, id ids.ID, idempotencyKey string) error
	// CompleteTask and ReopenTask are idempotent.
	CompleteTask(ctx context.Context, userID, id ids.ID) (Task, error)
	ReopenTask(ctx context.Context, userID, id ids.ID) (Task, error)
	GetStats(ctx context.Context, userID ids.ID) (Stats, error)
}

var _ Service = (*application.Service)(nil)

// AdminStats are counts over every owner's tasks.
type AdminStats = application.AdminStats

// AdminSortToken is the cursor ordering of AdminService.ListAllTasks.
const AdminSortToken = application.AdminSortToken

// AdminService is the operator view of tasks, used only by the admin module
// (behind the admin role policy). It is not owner-scoped. DeleteTaskTx runs in
// the caller's transaction so the admin module's audit entry commits
// atomically with the deletion (and its TaskDeleted event).
type AdminService interface {
	ListAllTasks(ctx context.Context, ownerID *ids.ID, search string, limit int32, after *pagination.Cursor) (ListResult, error)
	DeleteTaskTx(ctx context.Context, tx pgx.Tx, id ids.ID) (owner ids.ID, err error)
	Stats(ctx context.Context) (AdminStats, error)
	CountByOwners(ctx context.Context, owners []ids.ID) (map[ids.ID]int64, error)
}

var _ AdminService = (*application.AdminService)(nil)
