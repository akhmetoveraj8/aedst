package domain

import (
	sharederrors "github.com/aedst/server/internal/shared/errors"
	"github.com/aedst/server/internal/shared/ids"
	"github.com/aedst/server/internal/shared/pagination"
)

// This file is the listing vocabulary every feature of the module shares (the
// owner list of features/core, the operator list of features/operator) and that
// api/ re-exports. It lives in the module's shared domain because two features
// use it and a feature never imports another feature.

const (
	defaultPageSize = 20
	maxPageSize     = 100
)

// ListParams selects one keyset page of a user's tasks (see
// internal/shared/pagination). After is the cursor decoded from the client's
// page token, nil for the first page.
type ListParams struct {
	UserID        ids.ID
	Statuses      []Status
	Priorities    []Priority
	Search        string
	SortBy        string // "created_at" | "due_date"
	SortDirection string // "asc" | "desc"
	Limit         int
	After         *pagination.Cursor
}

// SortToken names the ordering of a request. It is embedded in cursors so a
// token cannot be replayed against a different ordering.
func (p ListParams) SortToken() string { return p.SortBy + ":" + p.SortDirection }

// Normalize applies the defaults for unset fields and rejects values the
// repository cannot honour (an unknown sort field or direction, an undefined
// status or priority) with a Validation error instead of passing them on to
// SQL. The page size is clamped, not rejected. Call it before SortToken so the
// token is stable whether or not the client spelled out the default ordering.
func (p *ListParams) Normalize() error {
	if p.Limit <= 0 {
		p.Limit = defaultPageSize
	}
	if p.Limit > maxPageSize {
		p.Limit = maxPageSize
	}
	if p.SortBy == "" {
		p.SortBy = "created_at"
	}
	if p.SortDirection == "" {
		p.SortDirection = "desc"
	}
	switch p.SortBy {
	case "created_at", "due_date":
	default:
		return sharederrors.Validation("tasks.ListTasks", "unsupported sort field")
	}
	switch p.SortDirection {
	case "asc", "desc":
	default:
		return sharederrors.Validation("tasks.ListTasks", "unsupported sort direction")
	}
	for _, s := range p.Statuses {
		if !s.Valid() {
			return sharederrors.Validation("tasks.ListTasks", "unsupported status filter")
		}
	}
	for _, pr := range p.Priorities {
		if !pr.Valid() {
			return sharederrors.Validation("tasks.ListTasks", "unsupported priority filter")
		}
	}
	return nil
}

// ListResult is one page. Total is the count of tasks matching the filter and
// is populated only on the first page (After == nil); on later pages it is 0
// because counting the matching set is O(rows) and keyset paging exists to
// avoid per-page O(rows) work.
type ListResult struct {
	Tasks []Task
	Next  *pagination.Cursor
	Total int
}

// Stats are one owner's task counts.
type Stats struct {
	Total      int
	Todo       int
	InProgress int
	Done       int
	Overdue    int
}

// MaxCountedTasks caps the total_count of a first ListTasks page: a user (or
// filter) matching more tasks than this reports exactly this number, meaning "at
// least". Counting is O(matching rows) and is paid once per list.
const MaxCountedTasks = 10_000

// AdminSortToken is the ordering of the operator listing (newest first).
const AdminSortToken = "admin:created_at:desc"

// AdminStats are counts over every owner's tasks.
type AdminStats struct {
	Total   int64
	Done    int64
	Overdue int64
}
