// Package postgres implements the reminders feature's DueSoonMarker against
// the sqlc-generated queries in gen/db/tasks. Not imported outside this module.
package postgres

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	tasksdb "github.com/aedst/server/gen/db/tasks"
	"github.com/aedst/server/internal/modules/tasks/api"
	"github.com/aedst/server/internal/modules/tasks/features/reminders/application"
	"github.com/aedst/server/internal/modules/tasks/infrastructure/store"
	"github.com/aedst/server/internal/platform/database"
	sharederrors "github.com/aedst/server/internal/shared/errors"
	"github.com/aedst/server/internal/shared/ids"
	sharedtime "github.com/aedst/server/internal/shared/time"
)

type Repository struct {
	pool   *pgxpool.Pool
	events store.Events
	clock  sharedtime.Clock
}

var _ application.DueSoonMarker = (*Repository)(nil)

// NewRepository builds the reminders repository over pool (the jobs pool: the
// reminder worker is its only caller).
func NewRepository(pool *pgxpool.Pool, events store.Events, clock sharedtime.Clock) *Repository {
	return &Repository{pool: pool, events: events, clock: clock}
}

// MarkDueSoon publishes TaskDueSoon for (id, dueDate) at most once: the guarded
// insert into tasks.due_soon_marks returns a row only the first time and only
// while the task is open and still due then. It reports whether it published.
func (r *Repository) MarkDueSoon(ctx context.Context, id, userID ids.ID, dueDate time.Time) (bool, error) {
	published := false
	err := database.WithTx(ctx, r.pool, func(ctx context.Context, tx pgx.Tx) error {
		q := tasksdb.New(tx)
		_, err := q.MarkDueSoon(ctx, tasksdb.MarkDueSoonParams{ID: store.UUID(id), UserID: store.UUID(userID), DueDate: store.Timestamptz(dueDate)})
		if errors.Is(err, pgx.ErrNoRows) {
			return nil // already published, done, deleted, or due date moved
		}
		if err != nil {
			return sharederrors.Wrap("tasks.MarkDueSoon", err)
		}
		row, err := q.FindTaskByIDAndUserID(ctx, tasksdb.FindTaskByIDAndUserIDParams{ID: store.UUID(id), UserID: store.UUID(userID)})
		if err != nil {
			return sharederrors.Wrap("tasks.MarkDueSoon", err)
		}
		published = true
		return r.events.Write(ctx, tx, api.TaskDueSoonEventType, api.TaskDueSoonEventVersion, id, api.TaskDueSoonEvent{
			TaskID:     id.String(),
			UserID:     userID.String(),
			Title:      row.Title,
			DueDate:    dueDate,
			OccurredAt: r.clock.Now(),
		})
	})
	if err != nil {
		return false, err
	}
	return published, nil
}
