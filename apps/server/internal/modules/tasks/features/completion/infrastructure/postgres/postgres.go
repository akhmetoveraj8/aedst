// Package postgres implements the completion feature's Repository against the
// sqlc-generated queries in gen/db/tasks. It is the reference implementation
// of a guarded transition that publishes an integration event in the same
// transaction. Not imported outside this module.
package postgres

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	tasksdb "github.com/aedst/server/gen/db/tasks"
	"github.com/aedst/server/internal/modules/tasks/api"
	"github.com/aedst/server/internal/modules/tasks/domain"
	"github.com/aedst/server/internal/modules/tasks/features/completion/application"
	"github.com/aedst/server/internal/modules/tasks/infrastructure/store"
	"github.com/aedst/server/internal/platform/database"
	sharederrors "github.com/aedst/server/internal/shared/errors"
	"github.com/aedst/server/internal/shared/ids"
)

type Repository struct {
	pool   *pgxpool.Pool
	events store.Events
}

var _ application.Repository = (*Repository)(nil)

// NewRepository builds the completion repository over pool.
func NewRepository(pool *pgxpool.Pool, events store.Events) *Repository {
	return &Repository{pool: pool, events: events}
}

// Complete moves id to done and, in the same transaction, writes a
// TaskCompleted event (see internal/platform/events: a River job per consumer, inserted in this transaction): an
// integration event another system's projection depends on (see
// docs/content/server/events.md) must not be silently lost. The UPDATE only matches a task
// that is not done yet, so a repeated or concurrent Complete finds no row,
// returns the current task and writes no second event.
func (r *Repository) Complete(ctx context.Context, id, userID ids.ID, now time.Time) (domain.Task, error) {
	var result domain.Task
	err := database.WithTx(ctx, r.pool, func(ctx context.Context, tx pgx.Tx) error {
		q := tasksdb.New(tx)
		row, err := q.CompleteTask(ctx, tasksdb.CompleteTaskParams{
			ID:     store.UUID(id),
			UserID: store.UUID(userID),
			Now:    store.Timestamptz(now),
		})
		if errors.Is(err, pgx.ErrNoRows) {
			// Already done, or not this user's task.
			existing, err := q.FindTaskByIDAndUserID(ctx, tasksdb.FindTaskByIDAndUserIDParams{ID: store.UUID(id), UserID: store.UUID(userID)})
			if errors.Is(err, pgx.ErrNoRows) {
				return sharederrors.NotFound("tasks.Complete", "task not found")
			}
			if err != nil {
				return sharederrors.Wrap("tasks.Complete", err)
			}
			result = store.TaskFromRow(existing)
			return nil
		}
		if err != nil {
			return sharederrors.Wrap("tasks.Complete", err)
		}
		result = store.TaskFromRow(row)

		return r.events.Write(ctx, tx, api.TaskCompletedEventType, api.TaskCompletedEventVersion, result.ID, api.TaskCompletedEvent{
			TaskID:      result.ID.String(),
			UserID:      result.UserID.String(),
			Title:       result.Title,
			CompletedAt: now,
			Version:     result.Version,
		})
	})
	if err != nil {
		return domain.Task{}, err
	}
	return result, nil
}

// Reopen moves a done task back to todo and, in the same transaction, publishes
// TaskUpdated with the post-reopen snapshot, so projections (search) see the
// transition. Like Complete, the UPDATE only matches a task that is done, so a
// repeated or concurrent Reopen finds no row, returns the current task and
// publishes nothing: one event per real mutation.
func (r *Repository) Reopen(ctx context.Context, id, userID ids.ID, now time.Time) (domain.Task, error) {
	var result domain.Task
	err := database.WithTx(ctx, r.pool, func(ctx context.Context, tx pgx.Tx) error {
		q := tasksdb.New(tx)
		row, err := q.ReopenTask(ctx, tasksdb.ReopenTaskParams{ID: store.UUID(id), UserID: store.UUID(userID), Now: store.Timestamptz(now)})
		if errors.Is(err, pgx.ErrNoRows) {
			// Already todo, or not this user's task.
			existing, err := q.FindTaskByIDAndUserID(ctx, tasksdb.FindTaskByIDAndUserIDParams{ID: store.UUID(id), UserID: store.UUID(userID)})
			if errors.Is(err, pgx.ErrNoRows) {
				return sharederrors.NotFound("tasks.FindByIDAndUserID", "task not found")
			}
			if err != nil {
				return sharederrors.Wrap("tasks.Reopen", err)
			}
			result = store.TaskFromRow(existing)
			return nil
		}
		if err != nil {
			return sharederrors.Wrap("tasks.Reopen", err)
		}
		result = store.TaskFromRow(row)
		return r.events.Write(ctx, tx, api.TaskUpdatedEventType, api.TaskUpdatedEventVersion, result.ID, api.SnapshotOf(result))
	})
	if err != nil {
		return domain.Task{}, err
	}
	return result, nil
}
