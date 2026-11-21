package postgres

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	tasksdb "github.com/aedst/server/gen/db/tasks"
	"github.com/aedst/server/internal/modules/tasks/domain"
	"github.com/aedst/server/internal/modules/tasks/infrastructure/store"
	sharederrors "github.com/aedst/server/internal/shared/errors"
	"github.com/aedst/server/internal/shared/ids"
	"github.com/aedst/server/internal/shared/like"
	"github.com/aedst/server/internal/shared/pagination"
)

// noDueSortKey is the sort key of a task without a due date. It must match
// the sentinel in sql/tasks/queries.sql (to_timestamp(-62135596800), i.e.
// 0001-01-01T00:00:00Z).
var noDueSortKey = time.Date(1, time.January, 1, 0, 0, 0, 0, time.UTC)

// List returns one keyset page. It fetches Limit+1 rows so it can tell
// whether a next page exists without a count. The filtered total is computed
// only for the first page (After == nil): counting the matching set is O(rows)
// and would otherwise be paid on every page.
func (r *Repository) List(ctx context.Context, params domain.ListParams) (domain.ListResult, error) {
	q := tasksdb.New(r.pool)
	asc := params.SortDirection == "asc"
	byDue := params.SortBy == "due_date"

	cursorKey, cursorID := store.OpenCursor(asc)
	if params.After != nil {
		cursorKey = pgtype.Timestamptz{Time: params.After.Key, Valid: true}
		cursorID = store.UUID(params.After.ID)
	}

	statuses, priorities := toDBStatuses(params.Statuses), toDBPriorities(params.Priorities)
	search := like.Escape(params.Search)
	limit := int32(params.Limit) + 1

	var (
		rows []tasksdb.TasksTask
		err  error
	)
	switch {
	case byDue && asc:
		rows, err = q.ListTasksByDueAsc(ctx, tasksdb.ListTasksByDueAscParams{UserID: store.UUID(params.UserID), Statuses: statuses, Priorities: priorities, Search: search, CursorKey: cursorKey, CursorID: cursorID, PageLimit: limit})
	case byDue:
		rows, err = q.ListTasksByDueDesc(ctx, tasksdb.ListTasksByDueDescParams{UserID: store.UUID(params.UserID), Statuses: statuses, Priorities: priorities, Search: search, CursorKey: cursorKey, CursorID: cursorID, PageLimit: limit})
	case asc:
		rows, err = q.ListTasksByCreatedAsc(ctx, tasksdb.ListTasksByCreatedAscParams{UserID: store.UUID(params.UserID), Statuses: statuses, Priorities: priorities, Search: search, CursorKey: cursorKey, CursorID: cursorID, PageLimit: limit})
	default:
		rows, err = q.ListTasksByCreatedDesc(ctx, tasksdb.ListTasksByCreatedDescParams{UserID: store.UUID(params.UserID), Statuses: statuses, Priorities: priorities, Search: search, CursorKey: cursorKey, CursorID: cursorID, PageLimit: limit})
	}
	if err != nil {
		return domain.ListResult{}, sharederrors.Wrap("tasks.List", err)
	}

	sortToken := params.SortToken()
	page := pagination.NewPage(store.TasksFromRows(rows), params.Limit, func(t domain.Task) pagination.Cursor {
		key := t.CreatedAt
		if byDue {
			key = noDueSortKey
			if t.DueDate != nil {
				key = *t.DueDate
			}
		}
		return pagination.Cursor{Sort: sortToken, Key: key, ID: t.ID}
	})

	result := domain.ListResult{Tasks: page.Items, Next: page.Next}
	if params.After == nil {
		total, err := q.CountTasks(ctx, tasksdb.CountTasksParams{UserID: store.UUID(params.UserID), Statuses: statuses, Priorities: priorities, Search: search, CountCap: domain.MaxCountedTasks})
		if err != nil {
			return domain.ListResult{}, sharederrors.Wrap("tasks.List.count", err)
		}
		result.Total = int(total)
	}
	return result, nil
}

func (r *Repository) Stats(ctx context.Context, userID ids.ID) (domain.Stats, error) {
	q := tasksdb.New(r.pool)
	row, err := q.GetTaskStats(ctx, store.UUID(userID))
	if err != nil {
		return domain.Stats{}, sharederrors.Wrap("tasks.Stats", err)
	}
	return domain.Stats{
		Total:      int(row.Total),
		Todo:       int(row.Todo),
		InProgress: int(row.InProgress),
		Done:       int(row.Done),
		Overdue:    int(row.Overdue),
	}, nil
}

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
