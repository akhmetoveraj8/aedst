package application

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/aedst/server/internal/shared/ids"
	"github.com/aedst/server/internal/shared/pagination"
)

// AdminSortToken is the ordering of the operator listing (newest first).
const AdminSortToken = "admin:created_at:desc"

// AdminListParams selects one keyset page across owners. OwnerID nil means
// every owner.
type AdminListParams struct {
	OwnerID *ids.ID
	Search  string
	Limit   int
	After   *pagination.Cursor
}

// AdminStats are counts over every owner's tasks.
type AdminStats struct {
	Total   int64
	Done    int64
	Overdue int64
}

// AdminRepository is the operator-side port. Unlike Repository it is not
// scoped to an owner, which is why it is only reachable through
// api.AdminService (used by the admin module behind the admin role).
type AdminRepository interface {
	AdminList(ctx context.Context, params AdminListParams) (ListResult, error)
	// AdminDeleteTx deletes inside the caller's transaction, publishing
	// TaskDeleted in it, and returns the owner.
	AdminDeleteTx(ctx context.Context, tx pgx.Tx, id ids.ID) (ids.ID, error)
	AdminStats(ctx context.Context) (AdminStats, error)
	CountByOwners(ctx context.Context, owners []ids.ID) (map[ids.ID]int64, error)
}

// DueSoonMarker publishes TaskDueSoon once per (task, due date).
type DueSoonMarker interface {
	MarkDueSoon(ctx context.Context, id, userID ids.ID, dueDate time.Time) (bool, error)
}

// AdminService implements api.AdminService.
type AdminService struct {
	repo AdminRepository
}

func NewAdminService(repo AdminRepository) *AdminService { return &AdminService{repo: repo} }

// ListAllTasks normalizes the page size and lists across owners. token is the
// opaque cursor of the previous page.
func (s *AdminService) ListAllTasks(ctx context.Context, ownerID *ids.ID, search string, limit int32, after *pagination.Cursor) (ListResult, error) {
	return s.repo.AdminList(ctx, AdminListParams{OwnerID: ownerID, Search: search, Limit: int(pagination.ClampLimit(limit)), After: after})
}

func (s *AdminService) DeleteTaskTx(ctx context.Context, tx pgx.Tx, id ids.ID) (ids.ID, error) {
	return s.repo.AdminDeleteTx(ctx, tx, id)
}

func (s *AdminService) Stats(ctx context.Context) (AdminStats, error) { return s.repo.AdminStats(ctx) }

func (s *AdminService) CountByOwners(ctx context.Context, owners []ids.ID) (map[ids.ID]int64, error) {
	if len(owners) == 0 {
		return map[ids.ID]int64{}, nil
	}
	return s.repo.CountByOwners(ctx, owners)
}
