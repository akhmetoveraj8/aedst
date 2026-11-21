package module

import (
	"context"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"

	tasksapi "github.com/aedst/server/internal/modules/tasks/api"
	operatorapp "github.com/aedst/server/internal/modules/tasks/features/operator/application"
	"github.com/aedst/server/internal/platform/cache"
	"github.com/aedst/server/internal/shared/ids"
)

// This file is the reference use of cache.Aside (apps/server/AGENTS.md, "When
// you need cache"): one owner's task counts, read on every dashboard load.
//
// Why here: the counts change through two features (core: create, edit,
// delete; completion: complete, reopen) and through the operator delete, and
// only this package sees all of them, so the read and every invalidation sit
// side by side in one decorator over api.Service.
//
// Staleness: a write invalidates the owner's key after it returns, so the next
// read reloads. Three cases are bounded by statsTTL instead: Overdue moving
// with the clock, a read that raced a write and stored the older counts, and
// an operator delete inside the admin module's transaction (DeleteTaskTx
// returns before that transaction commits). Counts are a display value; nothing
// decides anything from them.
const (
	statsCacheName = "tasks.stats"
	statsTTL       = 30 * time.Second
)

type statsCache struct {
	aside  *cache.Aside[tasksapi.Stats]
	logger *slog.Logger
}

func newStatsCache(store *cache.Store, logger *slog.Logger) statsCache {
	return statsCache{aside: cache.NewAside[tasksapi.Stats](store, statsCacheName, statsTTL), logger: logger}
}

// invalidate drops owner's counts. It runs even when the request was cancelled
// (the write may have committed) and never fails the write: the TTL is the
// backstop.
func (c statsCache) invalidate(ctx context.Context, owner ids.ID) {
	if owner == ids.Nil {
		return
	}
	if err := c.aside.Invalidate(context.WithoutCancel(ctx), owner.String()); err != nil {
		c.logger.WarnContext(ctx, "tasks: stats cache invalidation failed; the entry expires by TTL", slog.Any("error", err))
	}
}

// cachedService is api.Service with GetStats served cache-aside and every
// write that changes an owner's counts invalidating them.
type cachedService struct {
	tasksapi.Service
	stats statsCache
}

func (s cachedService) GetStats(ctx context.Context, userID ids.ID) (tasksapi.Stats, error) {
	return s.stats.aside.Get(ctx, userID.String(), func(ctx context.Context) (tasksapi.Stats, error) {
		return s.Service.GetStats(ctx, userID)
	})
}

func (s cachedService) CreateTask(ctx context.Context, userID ids.ID, title, description string, priority tasksapi.Priority, dueDate *time.Time, idempotencyKey string) (tasksapi.Task, error) {
	defer s.stats.invalidate(ctx, userID)
	return s.Service.CreateTask(ctx, userID, title, description, priority, dueDate, idempotencyKey)
}

// UpdateTask can move a task in or out of Overdue (due date).
func (s cachedService) UpdateTask(ctx context.Context, userID, id ids.ID, patch tasksapi.Patch, expectedVersion *int, idempotencyKey string) (tasksapi.Task, error) {
	defer s.stats.invalidate(ctx, userID)
	return s.Service.UpdateTask(ctx, userID, id, patch, expectedVersion, idempotencyKey)
}

func (s cachedService) DeleteTask(ctx context.Context, userID, id ids.ID, idempotencyKey string) error {
	defer s.stats.invalidate(ctx, userID)
	return s.Service.DeleteTask(ctx, userID, id, idempotencyKey)
}

func (s cachedService) CompleteTask(ctx context.Context, userID, id ids.ID) (tasksapi.Task, error) {
	defer s.stats.invalidate(ctx, userID)
	return s.Service.CompleteTask(ctx, userID, id)
}

func (s cachedService) ReopenTask(ctx context.Context, userID, id ids.ID) (tasksapi.Task, error) {
	defer s.stats.invalidate(ctx, userID)
	return s.Service.ReopenTask(ctx, userID, id)
}

// cachedOperator is the operator service with its deletes invalidating the
// deleted task's owner.
type cachedOperator struct {
	*operatorapp.AdminService
	stats statsCache
}

func (o cachedOperator) DeleteTaskTx(ctx context.Context, tx pgx.Tx, id ids.ID) (ids.ID, error) {
	owner, err := o.AdminService.DeleteTaskTx(ctx, tx, id)
	o.stats.invalidate(ctx, owner)
	return owner, err
}

func (o cachedOperator) DeleteTask(ctx context.Context, idempotencyKey string, id ids.ID) (ids.ID, error) {
	owner, err := o.AdminService.DeleteTask(ctx, idempotencyKey, id)
	o.stats.invalidate(ctx, owner)
	return owner, err
}
