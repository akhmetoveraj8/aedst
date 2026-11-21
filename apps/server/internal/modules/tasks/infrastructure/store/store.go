// Package store is the tasks module's shared persistence vocabulary: the
// mapping between tasks.tasks rows (sqlc, gen/db/tasks) and domain.Task, the
// keyset cursor of the first page and the one way an integration event is
// written. Every feature's infrastructure/postgres imports it; it imports no
// feature (features share code through the module, never through each other).
package store

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	tasksdb "github.com/aedst/server/gen/db/tasks"
	"github.com/aedst/server/internal/modules/tasks/api"
	"github.com/aedst/server/internal/modules/tasks/domain"
	sharederrors "github.com/aedst/server/internal/shared/errors"
	"github.com/aedst/server/internal/shared/ids"
	sharedtime "github.com/aedst/server/internal/shared/time"
)

// EventWriter persists an integration event inside the caller's transaction
// and schedules its delivery (one River job per consumer). Satisfied by
// events.Publisher.
type EventWriter interface {
	Publish(ctx context.Context, tx pgx.Tx, eventType string, version uint32, partitionKey ids.ID, payload any) (ids.ID, error)
}

// Events writes the module's integration events. One built over a nil writer
// refuses to write: a repository without a publisher cannot mutate.
type Events struct {
	writer EventWriter
	clock  sharedtime.Clock
}

// NewEvents binds the module's publisher. writer may be nil for read-only use.
func NewEvents(writer EventWriter, clock sharedtime.Clock) Events {
	return Events{writer: writer, clock: clock}
}

// Write records an integration event inside tx (transactional outbox via a
// River job per consumer, inserted with the caller's transaction).
func (e Events) Write(ctx context.Context, tx pgx.Tx, eventType string, version uint32, key ids.ID, payload any) error {
	if e.writer == nil {
		return sharederrors.Wrap("tasks.writeEvent", errors.New("repository has no event publisher"))
	}
	if _, err := e.writer.Publish(ctx, tx, eventType, version, key, payload); err != nil {
		return sharederrors.Wrap("tasks.writeEvent", err)
	}
	return nil
}

// WriteDeleted publishes TaskDeleted for a row that was at version when it was
// deleted. The owner delete (features/core) and the operator delete
// (features/operator) publish the same event through it.
func (e Events) WriteDeleted(ctx context.Context, tx pgx.Tx, id, userID ids.ID, version int) error {
	return e.Write(ctx, tx, api.TaskDeletedEventType, api.TaskDeletedEventVersion, id, api.TaskDeletedEvent{
		TaskID:    id.String(),
		UserID:    userID.String(),
		DeletedAt: e.clock.Now(),
		Version:   version + 1,
	})
}

// TaskFromRow maps a tasks.tasks row to the domain entity.
func TaskFromRow(row tasksdb.TasksTask) domain.Task {
	return domain.Task{
		ID:          IDFromUUID(row.ID),
		UserID:      IDFromUUID(row.UserID),
		Title:       row.Title,
		Description: row.Description,
		Status:      domain.Status(row.Status),
		Priority:    domain.Priority(row.Priority),
		DueDate:     timePtr(row.DueDate),
		CompletedAt: timePtr(row.CompletedAt),
		CreatedAt:   row.CreatedAt.Time,
		UpdatedAt:   row.UpdatedAt.Time,
		Version:     int(row.Version),
	}
}

// TasksFromRows maps a page of rows.
func TasksFromRows(rows []tasksdb.TasksTask) []domain.Task {
	tasks := make([]domain.Task, len(rows))
	for i, row := range rows {
		tasks[i] = TaskFromRow(row)
	}
	return tasks
}

func UUID(id ids.ID) pgtype.UUID { return pgtype.UUID{Bytes: id, Valid: !id.IsNil()} }

func IDFromUUID(u pgtype.UUID) ids.ID { return ids.ID(u.Bytes) }

func Timestamptz(t time.Time) pgtype.Timestamptz {
	return pgtype.Timestamptz{Time: t, Valid: !t.IsZero()}
}

func TimestamptzPtr(t *time.Time) pgtype.Timestamptz {
	if t == nil {
		return pgtype.Timestamptz{}
	}
	return pgtype.Timestamptz{Time: *t, Valid: true}
}

func timePtr(t pgtype.Timestamptz) *time.Time {
	if !t.Valid {
		return nil
	}
	return &t.Time
}

// OpenCursor is the "before everything" cursor for the first page: every row
// sorts strictly before (DESC) / after (ASC) it, so the keyset predicate is
// always true without a separate code path.
func OpenCursor(asc bool) (pgtype.Timestamptz, pgtype.UUID) {
	if asc {
		return pgtype.Timestamptz{InfinityModifier: pgtype.NegativeInfinity, Valid: true}, pgtype.UUID{Valid: true}
	}
	return pgtype.Timestamptz{InfinityModifier: pgtype.Infinity, Valid: true}, pgtype.UUID{Bytes: [16]byte{0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff}, Valid: true}
}
