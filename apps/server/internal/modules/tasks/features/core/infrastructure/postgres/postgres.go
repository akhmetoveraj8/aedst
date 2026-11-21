// Package postgres implements the core feature's Repository against the
// sqlc-generated queries in gen/db/tasks. Not imported outside this module.
package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	tasksdb "github.com/aedst/server/gen/db/tasks"
	"github.com/aedst/server/internal/modules/tasks/api"
	"github.com/aedst/server/internal/modules/tasks/domain"
	"github.com/aedst/server/internal/modules/tasks/features/core/application"
	"github.com/aedst/server/internal/modules/tasks/infrastructure/store"
	"github.com/aedst/server/internal/platform/database"
	"github.com/aedst/server/internal/platform/idempotency"
	sharederrors "github.com/aedst/server/internal/shared/errors"
	"github.com/aedst/server/internal/shared/ids"
	sharedtime "github.com/aedst/server/internal/shared/time"
)

// ReminderEnqueuer enqueues the due-date reminder job inside the caller's
// transaction, so the job exists if and only if the task change committed. It
// is this feature's port onto the reminders feature: tasks/module passes the
// reminders Scheduler in, the two features never import each other.
type ReminderEnqueuer interface {
	EnqueueDueReminder(ctx context.Context, tx pgx.Tx, taskID, userID ids.ID, dueDate time.Time) error
}

type Repository struct {
	pool        *pgxpool.Pool
	events      store.Events
	idempotency idempotency.Store
	reminders   ReminderEnqueuer
	clock       sharedtime.Clock
}

var _ application.Repository = (*Repository)(nil)

// Option customises optional collaborators of Repository.
type Option func(*Repository)

// WithReminders makes Create/Update enqueue due-date reminders atomically.
func WithReminders(r ReminderEnqueuer) Option { return func(repo *Repository) { repo.reminders = r } }

// NewRepository builds the core repository over pool.
func NewRepository(pool *pgxpool.Pool, events store.Events, clock sharedtime.Clock, opts ...Option) *Repository {
	r := &Repository{pool: pool, events: events, idempotency: idempotency.NewPostgresStore(), clock: clock}
	for _, opt := range opts {
		opt(r)
	}
	return r
}

// idempotencyScope namespaces a caller's keys: two users can never collide on,
// or replay, each other's keys.
func idempotencyScope(userID ids.ID) string { return "tasks:" + userID.String() }

// enqueueReminder schedules the reminder for task if it needs one.
func (r *Repository) enqueueReminder(ctx context.Context, tx pgx.Tx, task domain.Task) error {
	if r.reminders == nil || !task.NeedsReminder(r.clock.Now()) {
		return nil
	}
	if err := r.reminders.EnqueueDueReminder(ctx, tx, task.ID, task.UserID, *task.DueDate); err != nil {
		return sharederrors.Wrap("tasks.enqueueReminder", err)
	}
	return nil
}

// Create persists task. When idempotencyKey is non-empty, the write and the
// idempotency-key record commit in the same transaction (see
// internal/platform/idempotency), so a client retry after a dropped
// response replays the original result instead of creating a duplicate task,
// even when the retry races the original request, because Check serializes
// same-key requests with an advisory lock.
func (r *Repository) Create(ctx context.Context, task domain.Task, idempotencyKey string) (domain.Task, error) {
	// Hashed on the client-supplied fields only, never task.ID/CreatedAt,
	// which Service.CreateTask generates fresh on every call including
	// retries, and would otherwise make every replay look like a
	// different request (see idempotency.Check's doc comment on request
	// hash mismatch).
	requestPayload, err := json.Marshal(struct {
		Title       string          `json:"title"`
		Description string          `json:"description"`
		Priority    domain.Priority `json:"priority"`
		DueDate     *time.Time      `json:"due_date"`
	}{task.Title, task.Description, task.Priority, task.DueDate})
	if err != nil {
		return domain.Task{}, sharederrors.Wrap("tasks.Create", err)
	}
	scope := idempotencyScope(task.UserID)

	var result domain.Task
	err = database.WithTx(ctx, r.pool, func(ctx context.Context, tx pgx.Tx) error {
		if cached, replay, err := idempotency.Check(ctx, tx, r.idempotency, scope, idempotencyKey, requestPayload); err != nil {
			return err
		} else if replay {
			return json.Unmarshal(cached, &result)
		}

		row, err := tasksdb.New(tx).CreateTask(ctx, tasksdb.CreateTaskParams{
			ID:          store.UUID(task.ID),
			UserID:      store.UUID(task.UserID),
			Title:       task.Title,
			Description: task.Description,
			Priority:    tasksdb.TasksPriority(task.Priority),
			DueDate:     store.TimestamptzPtr(task.DueDate),
			CreatedAt:   store.Timestamptz(task.CreatedAt),
		})
		if err != nil {
			return sharederrors.Wrap("tasks.Create", err)
		}
		result = store.TaskFromRow(row)

		if err := r.enqueueReminder(ctx, tx, result); err != nil {
			return err
		}
		if err := r.events.Write(ctx, tx, api.TaskCreatedEventType, api.TaskCreatedEventVersion, result.ID, api.SnapshotOf(result)); err != nil {
			return err
		}
		resultPayload, err := json.Marshal(result)
		if err != nil {
			return sharederrors.Wrap("tasks.Create", err)
		}
		return idempotency.Save(ctx, tx, r.idempotency, scope, idempotencyKey, requestPayload, resultPayload)
	})
	if err != nil {
		return domain.Task{}, err
	}
	return result, nil
}

func (r *Repository) FindByIDAndUserID(ctx context.Context, id, userID ids.ID) (domain.Task, error) {
	q := tasksdb.New(r.pool)
	row, err := q.FindTaskByIDAndUserID(ctx, tasksdb.FindTaskByIDAndUserIDParams{
		ID:     store.UUID(id),
		UserID: store.UUID(userID),
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Task{}, sharederrors.NotFound("tasks.FindByIDAndUserID", "task not found")
		}
		return domain.Task{}, sharederrors.Wrap("tasks.FindByIDAndUserID", err)
	}
	return store.TaskFromRow(row), nil
}

func updateParams(p application.UpdateParams) tasksdb.UpdateTaskParams {
	out := tasksdb.UpdateTaskParams{
		ID:         store.UUID(p.ID),
		UserID:     store.UUID(p.UserID),
		SetDueDate: p.Patch.SetDueDate,
		DueDate:    store.TimestamptzPtr(p.Patch.DueDate),
		UpdatedAt:  store.Timestamptz(p.UpdatedAt),
	}
	if p.Patch.Title != nil {
		out.Title = pgtype.Text{String: *p.Patch.Title, Valid: true}
	}
	if p.Patch.Description != nil {
		out.Description = pgtype.Text{String: *p.Patch.Description, Valid: true}
	}
	if p.Patch.Priority != nil {
		out.Priority = pgtype.Text{String: string(*p.Patch.Priority), Valid: true}
	}
	if p.ExpectedVersion != nil {
		out.ExpectedVersion = pgtype.Int4{Int32: int32(*p.ExpectedVersion), Valid: true}
	}
	return out
}

// Update applies the patch in one statement and, in the same transaction,
// publishes TaskUpdated with the post-update snapshot (and enqueues the
// reminder when the due date changed). When the UPDATE matches no row, one
// follow-up read tells "not found" from "stale version"; nothing is published.
func (r *Repository) Update(ctx context.Context, params application.UpdateParams) (domain.Task, error) {
	// Hashed on the client-supplied fields only (never UpdatedAt, generated per
	// call), and tagged with the operation so one key cannot be replayed across RPCs.
	requestPayload, err := json.Marshal(struct {
		Op              string       `json:"op"`
		ID              ids.ID       `json:"id"`
		Patch           domain.Patch `json:"patch"`
		ExpectedVersion *int         `json:"expected_version"`
	}{"update", params.ID, params.Patch, params.ExpectedVersion})
	if err != nil {
		return domain.Task{}, sharederrors.Wrap("tasks.Update", err)
	}
	scope := idempotencyScope(params.UserID)

	var result domain.Task
	err = database.WithTx(ctx, r.pool, func(ctx context.Context, tx pgx.Tx) error {
		if cached, replay, err := idempotency.Check(ctx, tx, r.idempotency, scope, params.IdempotencyKey, requestPayload); err != nil {
			return err
		} else if replay {
			return json.Unmarshal(cached, &result)
		}
		q := tasksdb.New(tx)
		row, err := q.UpdateTask(ctx, updateParams(params))
		if errors.Is(err, pgx.ErrNoRows) {
			if _, findErr := q.FindTaskByIDAndUserID(ctx, tasksdb.FindTaskByIDAndUserIDParams{ID: store.UUID(params.ID), UserID: store.UUID(params.UserID)}); findErr == nil {
				return sharederrors.Conflict("tasks.Update", "task was modified by someone else; reload and retry").WithReason("STALE_VERSION")
			}
			return sharederrors.NotFound("tasks.Update", "task not found")
		}
		if err != nil {
			return sharederrors.Wrap("tasks.Update", err)
		}
		result = store.TaskFromRow(row)
		if params.Patch.SetDueDate {
			if err := r.enqueueReminder(ctx, tx, result); err != nil {
				return err
			}
		}
		if err := r.events.Write(ctx, tx, api.TaskUpdatedEventType, api.TaskUpdatedEventVersion, result.ID, api.SnapshotOf(result)); err != nil {
			return err
		}
		resultPayload, err := json.Marshal(result)
		if err != nil {
			return sharederrors.Wrap("tasks.Update", err)
		}
		return idempotency.Save(ctx, tx, r.idempotency, scope, params.IdempotencyKey, requestPayload, resultPayload)
	})
	if err != nil {
		return domain.Task{}, err
	}
	return result, nil
}

// Delete removes the caller's task and publishes TaskDeleted in the same
// transaction. Nothing matched (someone else's or a nonexistent id) is
// NotFound and publishes nothing.
func (r *Repository) Delete(ctx context.Context, id, userID ids.ID, idempotencyKey string) error {
	requestPayload := []byte(`{"op":"delete","id":"` + id.String() + `"}`)
	scope := idempotencyScope(userID)
	return database.WithTx(ctx, r.pool, func(ctx context.Context, tx pgx.Tx) error {
		// A retry of a delete that already committed must succeed, not NotFound.
		if _, replay, err := idempotency.Check(ctx, tx, r.idempotency, scope, idempotencyKey, requestPayload); err != nil {
			return err
		} else if replay {
			return nil
		}
		version, err := tasksdb.New(tx).DeleteTask(ctx, tasksdb.DeleteTaskParams{ID: store.UUID(id), UserID: store.UUID(userID)})
		if errors.Is(err, pgx.ErrNoRows) {
			return sharederrors.NotFound("tasks.Delete", "task not found")
		}
		if err != nil {
			return sharederrors.Wrap("tasks.Delete", err)
		}
		if err := r.events.WriteDeleted(ctx, tx, id, userID, int(version)); err != nil {
			return err
		}
		return idempotency.Save(ctx, tx, r.idempotency, scope, idempotencyKey, requestPayload, []byte(`{}`))
	})
}
