// Package postgres implements the tasks module's Repository against the
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
	"github.com/aedst/server/internal/modules/tasks/application"
	"github.com/aedst/server/internal/modules/tasks/domain"
	"github.com/aedst/server/internal/platform/database"
	"github.com/aedst/server/internal/platform/idempotency"
	sharederrors "github.com/aedst/server/internal/shared/errors"
	"github.com/aedst/server/internal/shared/ids"
	"github.com/aedst/server/internal/shared/like"
	"github.com/aedst/server/internal/shared/pagination"
	sharedtime "github.com/aedst/server/internal/shared/time"
)

// EventWriter persists an integration event inside the caller's transaction
// and schedules its delivery (one River job per consumer). Satisfied by
// events.Publisher.
type EventWriter interface {
	Publish(ctx context.Context, tx pgx.Tx, eventType string, version uint32, partitionKey ids.ID, payload any) (ids.ID, error)
}

// ReminderEnqueuer enqueues the due-date reminder job inside the caller's
// transaction, so the job exists if and only if the task change committed.
// Satisfied by infrastructure/jobs.Scheduler.
type ReminderEnqueuer interface {
	EnqueueDueReminder(ctx context.Context, tx pgx.Tx, taskID, userID ids.ID, dueDate time.Time) error
}

type Repository struct {
	pool        *pgxpool.Pool
	events      EventWriter
	idempotency idempotency.Store
	reminders   ReminderEnqueuer
	clock       sharedtime.Clock
}

var _ application.Repository = (*Repository)(nil)

// Option customises optional collaborators of Repository.
type Option func(*Repository)

// WithReminders makes Create/Update enqueue due-date reminders atomically.
func WithReminders(r ReminderEnqueuer) Option { return func(repo *Repository) { repo.reminders = r } }

// NewRepository builds the tasks repository over pool. publisher may be nil
// for read-only use (the reminder worker only calls FindByIDAndUserID).
func NewRepository(pool *pgxpool.Pool, publisher EventWriter, clock sharedtime.Clock, opts ...Option) *Repository {
	r := &Repository{pool: pool, events: publisher, idempotency: idempotency.NewPostgresStore(), clock: clock}
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
// response replays the original result instead of creating a duplicate task —
// even when the retry races the original request, because Check serializes
// same-key requests with an advisory lock.
func (r *Repository) Create(ctx context.Context, task domain.Task, idempotencyKey string) (domain.Task, error) {
	// Hashed on the client-supplied fields only — never task.ID/CreatedAt,
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
			ID:          toPgUUID(task.ID),
			UserID:      toPgUUID(task.UserID),
			Title:       task.Title,
			Description: task.Description,
			Priority:    toDBPriority(task.Priority),
			DueDate:     toPgTimestamptzPtr(task.DueDate),
			CreatedAt:   toPgTimestamptz(task.CreatedAt),
		})
		if err != nil {
			return sharederrors.Wrap("tasks.Create", err)
		}
		result = fromDB(row)

		if err := r.enqueueReminder(ctx, tx, result); err != nil {
			return err
		}
		if err := r.writeEvent(ctx, tx, api.TaskCreatedEventType, api.TaskCreatedEventVersion, result.ID, api.SnapshotOf(result)); err != nil {
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

// Complete moves id to done and, in the same transaction, writes a
// TaskCompleted event (see internal/platform/events: a River job per consumer, inserted in this transaction) — an
// integration event another system's projection depends on (see
// docs/content/server/events.md) must not be silently lost. The UPDATE only matches a task
// that is not done yet, so a repeated or concurrent Complete finds no row,
// returns the current task and writes no second event.
func (r *Repository) Complete(ctx context.Context, id, userID ids.ID, now time.Time) (domain.Task, error) {
	var result domain.Task
	err := database.WithTx(ctx, r.pool, func(ctx context.Context, tx pgx.Tx) error {
		q := tasksdb.New(tx)
		row, err := q.CompleteTask(ctx, tasksdb.CompleteTaskParams{
			ID:     toPgUUID(id),
			UserID: toPgUUID(userID),
			Now:    toPgTimestamptz(now),
		})
		if errors.Is(err, pgx.ErrNoRows) {
			// Already done, or not this user's task.
			existing, err := q.FindTaskByIDAndUserID(ctx, tasksdb.FindTaskByIDAndUserIDParams{ID: toPgUUID(id), UserID: toPgUUID(userID)})
			if errors.Is(err, pgx.ErrNoRows) {
				return sharederrors.NotFound("tasks.Complete", "task not found")
			}
			if err != nil {
				return sharederrors.Wrap("tasks.Complete", err)
			}
			result = fromDB(existing)
			return nil
		}
		if err != nil {
			return sharederrors.Wrap("tasks.Complete", err)
		}
		result = fromDB(row)

		return r.writeEvent(ctx, tx, api.TaskCompletedEventType, api.TaskCompletedEventVersion, result.ID, api.TaskCompletedEvent{
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
		row, err := q.ReopenTask(ctx, tasksdb.ReopenTaskParams{ID: toPgUUID(id), UserID: toPgUUID(userID), Now: toPgTimestamptz(now)})
		if errors.Is(err, pgx.ErrNoRows) {
			// Already todo, or not this user's task.
			existing, err := q.FindTaskByIDAndUserID(ctx, tasksdb.FindTaskByIDAndUserIDParams{ID: toPgUUID(id), UserID: toPgUUID(userID)})
			if errors.Is(err, pgx.ErrNoRows) {
				return sharederrors.NotFound("tasks.FindByIDAndUserID", "task not found")
			}
			if err != nil {
				return sharederrors.Wrap("tasks.Reopen", err)
			}
			result = fromDB(existing)
			return nil
		}
		if err != nil {
			return sharederrors.Wrap("tasks.Reopen", err)
		}
		result = fromDB(row)
		return r.writeEvent(ctx, tx, api.TaskUpdatedEventType, api.TaskUpdatedEventVersion, result.ID, api.SnapshotOf(result))
	})
	if err != nil {
		return domain.Task{}, err
	}
	return result, nil
}

func (r *Repository) FindByIDAndUserID(ctx context.Context, id, userID ids.ID) (domain.Task, error) {
	q := tasksdb.New(r.pool)
	row, err := q.FindTaskByIDAndUserID(ctx, tasksdb.FindTaskByIDAndUserIDParams{
		ID:     toPgUUID(id),
		UserID: toPgUUID(userID),
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Task{}, sharederrors.NotFound("tasks.FindByIDAndUserID", "task not found")
		}
		return domain.Task{}, sharederrors.Wrap("tasks.FindByIDAndUserID", err)
	}
	return fromDB(row), nil
}

func updateParams(p application.UpdateParams) tasksdb.UpdateTaskParams {
	out := tasksdb.UpdateTaskParams{
		ID:         toPgUUID(p.ID),
		UserID:     toPgUUID(p.UserID),
		SetDueDate: p.Patch.SetDueDate,
		DueDate:    toPgTimestamptzPtr(p.Patch.DueDate),
		UpdatedAt:  toPgTimestamptz(p.UpdatedAt),
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

// noDueSortKey is the sort key of a task without a due date. It must match
// the sentinel in sql/tasks/queries.sql (to_timestamp(-62135596800), i.e.
// 0001-01-01T00:00:00Z).
var noDueSortKey = time.Date(1, time.January, 1, 0, 0, 0, 0, time.UTC)

// List returns one keyset page. It fetches Limit+1 rows so it can tell
// whether a next page exists without a count. The filtered total is computed
// only for the first page (After == nil): counting the matching set is O(rows)
// and would otherwise be paid on every page.
func (r *Repository) List(ctx context.Context, params application.ListParams) (application.ListResult, error) {
	q := tasksdb.New(r.pool)
	asc := params.SortDirection == "asc"
	byDue := params.SortBy == "due_date"

	cursorKey, cursorID := openCursor(asc)
	if params.After != nil {
		cursorKey = pgtype.Timestamptz{Time: params.After.Key, Valid: true}
		cursorID = toPgUUID(params.After.ID)
	}

	statuses, priorities := toDBStatuses(params.Statuses), toDBPriorities(params.Priorities)
	search := escapeLike(params.Search)
	limit := int32(params.Limit) + 1

	var (
		rows []tasksdb.TasksTask
		err  error
	)
	switch {
	case byDue && asc:
		rows, err = q.ListTasksByDueAsc(ctx, tasksdb.ListTasksByDueAscParams{UserID: toPgUUID(params.UserID), Statuses: statuses, Priorities: priorities, Search: search, CursorKey: cursorKey, CursorID: cursorID, PageLimit: limit})
	case byDue:
		rows, err = q.ListTasksByDueDesc(ctx, tasksdb.ListTasksByDueDescParams{UserID: toPgUUID(params.UserID), Statuses: statuses, Priorities: priorities, Search: search, CursorKey: cursorKey, CursorID: cursorID, PageLimit: limit})
	case asc:
		rows, err = q.ListTasksByCreatedAsc(ctx, tasksdb.ListTasksByCreatedAscParams{UserID: toPgUUID(params.UserID), Statuses: statuses, Priorities: priorities, Search: search, CursorKey: cursorKey, CursorID: cursorID, PageLimit: limit})
	default:
		rows, err = q.ListTasksByCreatedDesc(ctx, tasksdb.ListTasksByCreatedDescParams{UserID: toPgUUID(params.UserID), Statuses: statuses, Priorities: priorities, Search: search, CursorKey: cursorKey, CursorID: cursorID, PageLimit: limit})
	}
	if err != nil {
		return application.ListResult{}, sharederrors.Wrap("tasks.List", err)
	}

	tasks := make([]domain.Task, len(rows))
	for i, row := range rows {
		tasks[i] = fromDB(row)
	}
	sortToken := params.SortToken()
	page := pagination.NewPage(tasks, params.Limit, func(t domain.Task) pagination.Cursor {
		key := t.CreatedAt
		if byDue {
			key = noDueSortKey
			if t.DueDate != nil {
				key = *t.DueDate
			}
		}
		return pagination.Cursor{Sort: sortToken, Key: key, ID: t.ID}
	})

	result := application.ListResult{Tasks: page.Items, Next: page.Next}
	if params.After == nil {
		total, err := q.CountTasks(ctx, tasksdb.CountTasksParams{UserID: toPgUUID(params.UserID), Statuses: statuses, Priorities: priorities, Search: search, CountCap: application.MaxCountedTasks})
		if err != nil {
			return application.ListResult{}, sharederrors.Wrap("tasks.List.count", err)
		}
		result.Total = int(total)
	}
	return result, nil
}

// openCursor is the "before everything" cursor for the first page: every row
// sorts strictly before (DESC) / after (ASC) it, so the keyset predicate is
// always true without a separate code path.
func openCursor(asc bool) (pgtype.Timestamptz, pgtype.UUID) {
	if asc {
		return pgtype.Timestamptz{InfinityModifier: pgtype.NegativeInfinity, Valid: true}, pgtype.UUID{Valid: true}
	}
	return pgtype.Timestamptz{InfinityModifier: pgtype.Infinity, Valid: true}, pgtype.UUID{Bytes: [16]byte{0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff}, Valid: true}
}

func escapeLike(s string) string { return like.Escape(s) }
func (r *Repository) Stats(ctx context.Context, userID ids.ID) (application.Stats, error) {
	q := tasksdb.New(r.pool)
	row, err := q.GetTaskStats(ctx, toPgUUID(userID))
	if err != nil {
		return application.Stats{}, sharederrors.Wrap("tasks.Stats", err)
	}
	return application.Stats{
		Total:      int(row.Total),
		Todo:       int(row.Todo),
		InProgress: int(row.InProgress),
		Done:       int(row.Done),
		Overdue:    int(row.Overdue),
	}, nil
}

func fromDB(row tasksdb.TasksTask) domain.Task {
	return domain.Task{
		ID:          fromPgUUID(row.ID),
		UserID:      fromPgUUID(row.UserID),
		Title:       row.Title,
		Description: row.Description,
		Status:      fromDBStatus(row.Status),
		Priority:    fromDBPriority(row.Priority),
		DueDate:     fromPgTimestamptzPtr(row.DueDate),
		CompletedAt: fromPgTimestamptzPtr(row.CompletedAt),
		CreatedAt:   row.CreatedAt.Time,
		UpdatedAt:   row.UpdatedAt.Time,
		Version:     int(row.Version),
	}
}

func toPgUUID(id ids.ID) pgtype.UUID {
	return pgtype.UUID{Bytes: id, Valid: !id.IsNil()}
}

func fromPgUUID(u pgtype.UUID) ids.ID {
	return ids.ID(u.Bytes)
}

func toPgTimestamptz(t time.Time) pgtype.Timestamptz {
	return pgtype.Timestamptz{Time: t, Valid: !t.IsZero()}
}

func toPgTimestamptzPtr(t *time.Time) pgtype.Timestamptz {
	if t == nil {
		return pgtype.Timestamptz{}
	}
	return pgtype.Timestamptz{Time: *t, Valid: true}
}

func fromPgTimestamptzPtr(t pgtype.Timestamptz) *time.Time {
	if !t.Valid {
		return nil
	}
	return &t.Time
}

func fromDBStatus(s tasksdb.TasksStatus) domain.Status       { return domain.Status(s) }
func toDBPriority(p domain.Priority) tasksdb.TasksPriority   { return tasksdb.TasksPriority(p) }
func fromDBPriority(p tasksdb.TasksPriority) domain.Priority { return domain.Priority(p) }

// toDBStatuses/toDBPriorities pass filters as text[]: pgx cannot encode a
// slice of a Go string type into an enum array (the array's OID is unknown to
// it), so the query casts text[] to the enum array server-side. An empty slice
// means "no filter".
func toDBStatuses(statuses []domain.Status) []string {
	out := make([]string, len(statuses))
	for i, s := range statuses {
		out[i] = string(s)
	}
	return out
}

func toDBPriorities(priorities []domain.Priority) []string {
	out := make([]string, len(priorities))
	for i, p := range priorities {
		out[i] = string(p)
	}
	return out
}
