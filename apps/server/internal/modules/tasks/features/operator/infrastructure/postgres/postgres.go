// Package postgres implements the operator feature's AdminRepository against
// the sqlc-generated queries in gen/db/tasks: operations that are not scoped
// to an owner. Not imported outside this module.
package postgres

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	tasksdb "github.com/aedst/server/gen/db/tasks"
	"github.com/aedst/server/internal/modules/tasks/domain"
	"github.com/aedst/server/internal/modules/tasks/features/operator/application"
	"github.com/aedst/server/internal/modules/tasks/infrastructure/store"
	"github.com/aedst/server/internal/platform/database"
	"github.com/aedst/server/internal/platform/idempotency"
	sharederrors "github.com/aedst/server/internal/shared/errors"
	"github.com/aedst/server/internal/shared/ids"
	"github.com/aedst/server/internal/shared/like"
	"github.com/aedst/server/internal/shared/pagination"
)

type Repository struct {
	pool        *pgxpool.Pool
	events      store.Events
	idempotency idempotency.Store
}

var _ application.AdminRepository = (*Repository)(nil)

// NewRepository builds the operator repository over pool.
func NewRepository(pool *pgxpool.Pool, events store.Events) *Repository {
	return &Repository{pool: pool, events: events, idempotency: idempotency.NewPostgresStore()}
}

// AdminList pages every owner's tasks (or one owner's), newest first.
func (r *Repository) AdminList(ctx context.Context, params application.AdminListParams) (domain.ListResult, error) {
	cursorKey, cursorID := store.OpenCursor(false)
	if params.After != nil {
		cursorKey = pgtype.Timestamptz{Time: params.After.Key, Valid: true}
		cursorID = store.UUID(params.After.ID)
	}
	var owner pgtype.UUID
	if params.OwnerID != nil {
		owner = store.UUID(*params.OwnerID)
	}
	rows, err := tasksdb.New(r.pool).AdminListTasks(ctx, tasksdb.AdminListTasksParams{
		OwnerID:   owner,
		Search:    like.Escape(params.Search),
		CursorKey: cursorKey,
		CursorID:  cursorID,
		PageLimit: int32(params.Limit) + 1,
	})
	if err != nil {
		return domain.ListResult{}, sharederrors.Wrap("tasks.AdminList", err)
	}
	page := pagination.NewPage(store.TasksFromRows(rows), params.Limit, func(t domain.Task) pagination.Cursor {
		return pagination.Cursor{Sort: domain.AdminSortToken, Key: t.CreatedAt, ID: t.ID}
	})
	return domain.ListResult{Tasks: page.Items, Next: page.Next}, nil
}

// AdminDeleteTx deletes any task inside the caller's transaction (the admin
// module's audit transaction) and publishes TaskDeleted in it. It returns the
// deleted task's owner.
func (r *Repository) AdminDeleteTx(ctx context.Context, tx pgx.Tx, id ids.ID) (ids.ID, error) {
	row, err := tasksdb.New(tx).AdminDeleteTask(ctx, store.UUID(id))
	if errors.Is(err, pgx.ErrNoRows) {
		return ids.Nil, sharederrors.NotFound("tasks.AdminDelete", "task not found")
	}
	if err != nil {
		return ids.Nil, sharederrors.Wrap("tasks.AdminDelete", err)
	}
	owner := store.IDFromUUID(row.UserID)
	return owner, r.events.WriteDeleted(ctx, tx, id, owner, int(row.Version))
}

// operatorScope namespaces operator idempotency keys apart from the per-user
// keys of the core feature.
const operatorScope = "tasks.operator"

// AdminDeleteIdempotent is AdminDeleteTx in a transaction of its own, replay-safe
// on key: the key check, the delete, the TaskDeleted event and the saved result
// commit together, so a retry after a lost response neither fails with NotFound
// nor publishes a second event.
func (r *Repository) AdminDeleteIdempotent(ctx context.Context, key string, id ids.ID) (ids.ID, error) {
	payload, err := json.Marshal(struct {
		TaskID string `json:"task_id"`
	}{id.String()})
	if err != nil {
		return ids.Nil, sharederrors.Wrap("tasks.OperatorDelete", err)
	}
	var owner ids.ID
	err = database.WithTx(ctx, r.pool, func(ctx context.Context, tx pgx.Tx) error {
		if cached, replay, err := idempotency.Check(ctx, tx, r.idempotency, operatorScope, key, payload); err != nil {
			return err
		} else if replay {
			var res struct {
				OwnerID string `json:"owner_id"`
			}
			if err := json.Unmarshal(cached, &res); err != nil {
				return err
			}
			owner, err = ids.Parse(res.OwnerID)
			return err
		}
		var err error
		if owner, err = r.AdminDeleteTx(ctx, tx, id); err != nil {
			return err
		}
		result, err := json.Marshal(struct {
			OwnerID string `json:"owner_id"`
		}{owner.String()})
		if err != nil {
			return err
		}
		return idempotency.Save(ctx, tx, r.idempotency, operatorScope, key, payload, result)
	})
	if err != nil {
		return ids.Nil, err
	}
	return owner, nil
}

func (r *Repository) AdminStats(ctx context.Context) (domain.AdminStats, error) {
	row, err := tasksdb.New(r.pool).AdminTaskStats(ctx, adminStatsRowCap)
	if err != nil {
		return domain.AdminStats{}, sharederrors.Wrap("tasks.AdminStats", err)
	}
	return domain.AdminStats{Total: row.Total, Done: row.Done, Overdue: row.Overdue}, nil
}

func (r *Repository) CountByOwners(ctx context.Context, owners []ids.ID) (map[ids.ID]int64, error) {
	pg := make([]pgtype.UUID, len(owners))
	for i, o := range owners {
		pg[i] = store.UUID(o)
	}
	rows, err := tasksdb.New(r.pool).CountTasksByOwners(ctx, pg)
	if err != nil {
		return nil, sharederrors.Wrap("tasks.CountByOwners", err)
	}
	out := make(map[ids.ID]int64, len(rows))
	for _, row := range rows {
		out[store.IDFromUUID(row.UserID)] = row.TaskCount
	}
	return out, nil
}

// adminStatsRowCap bounds the platform-wide task counts of the operator
// overview: beyond it the figures are lower bounds (see AdminTaskStats).
const adminStatsRowCap = 1_000_000
