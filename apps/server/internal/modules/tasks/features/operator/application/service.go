// Package application holds the use cases of the tasks module's operator
// feature: the cross-owner list, counts and delete that the admin module
// drives (api.AdminService in process, api.OperatorService over the network).
package application

import (
	"context"

	"github.com/jackc/pgx/v5"

	"github.com/aedst/server/internal/modules/tasks/domain"
	sharederrors "github.com/aedst/server/internal/shared/errors"
	"github.com/aedst/server/internal/shared/ids"
	"github.com/aedst/server/internal/shared/pagination"
)

// AdminListParams selects one keyset page across owners. OwnerID nil means
// every owner.
type AdminListParams struct {
	OwnerID *ids.ID
	Search  string
	Limit   int
	After   *pagination.Cursor
}

// AdminRepository is the operator-side port. Unlike the core feature's
// Repository it is not scoped to an owner, which is why it is only reachable
// through api.AdminService (used by the admin module behind the admin role).
type AdminRepository interface {
	AdminList(ctx context.Context, params AdminListParams) (domain.ListResult, error)
	// AdminDeleteTx deletes inside the caller's transaction, publishing
	// TaskDeleted in it, and returns the owner.
	AdminDeleteTx(ctx context.Context, tx pgx.Tx, id ids.ID) (ids.ID, error)
	// AdminDeleteIdempotent is AdminDeleteTx in its own transaction, replay-safe on
	// key (scope "tasks.operator"): a retry with the same key and task returns the
	// first result, the same key for another task is a Conflict.
	AdminDeleteIdempotent(ctx context.Context, key string, id ids.ID) (ids.ID, error)
	AdminStats(ctx context.Context) (domain.AdminStats, error)
	CountByOwners(ctx context.Context, owners []ids.ID) (map[ids.ID]int64, error)
}

// AdminService implements api.AdminService and api.OperatorService.
type AdminService struct {
	repo AdminRepository
}

func NewAdminService(repo AdminRepository) *AdminService { return &AdminService{repo: repo} }

// ListAllTasks normalizes the page size and lists across owners. after is the
// decoded cursor of the previous page.
func (s *AdminService) ListAllTasks(ctx context.Context, ownerID *ids.ID, search string, limit int32, after *pagination.Cursor) (domain.ListResult, error) {
	return s.repo.AdminList(ctx, AdminListParams{OwnerID: ownerID, Search: search, Limit: int(pagination.ClampLimit(limit)), After: after})
}

func (s *AdminService) DeleteTaskTx(ctx context.Context, tx pgx.Tx, id ids.ID) (ids.ID, error) {
	return s.repo.AdminDeleteTx(ctx, tx, id)
}

// DeleteTask deletes any owner's task in its own transaction, safely repeatable
// on key. It is the network-safe counterpart of DeleteTaskTx (api.OperatorService).
func (s *AdminService) DeleteTask(ctx context.Context, key string, id ids.ID) (ids.ID, error) {
	if key == "" {
		return ids.Nil, sharederrors.Validation("tasks.OperatorDelete", "an idempotency key is required")
	}
	return s.repo.AdminDeleteIdempotent(ctx, key, id)
}

func (s *AdminService) Stats(ctx context.Context) (domain.AdminStats, error) {
	return s.repo.AdminStats(ctx)
}

func (s *AdminService) CountByOwners(ctx context.Context, owners []ids.ID) (map[ids.ID]int64, error) {
	if len(owners) == 0 {
		return map[ids.ID]int64{}, nil
	}
	return s.repo.CountByOwners(ctx, owners)
}
