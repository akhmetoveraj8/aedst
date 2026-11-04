// Package pagination provides keyset (cursor) pagination primitives. Every
// collection that can grow large (tasks, notifications, feeds, messages,
// listings) pages with a cursor instead of OFFSET: OFFSET n makes Postgres
// read and discard n rows on every request, so page N costs O(N), and rows
// inserted between requests shift pages. A keyset predicate
// `(sort_key, id) > (cursor.key, cursor.id)` is an index range scan whose cost
// is independent of how deep the client has paged.
//
// Contract for a paginated query (see modules/tasks/sql for the reference):
//
//   - order by a total order: a sort key plus the unique id as tiebreaker,
//     with a composite index whose leading columns are the owner id (the
//     shard/tenant key, see ADR-0010) followed by that same order;
//   - fetch limit+1 rows and hand them to [NewPage], which trims the extra
//     row and derives the next cursor from the last row returned;
//   - never compute a total count on the paging path — a count(*) over the
//     matching set is the same O(N) cost keyset pagination exists to avoid.
package pagination

import (
	"encoding/base64"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/aedst/server/internal/shared/ids"
)

const (
	DefaultLimit = 20
	MaxLimit     = 100

	cursorVersion = "1"
)

// Cursor is the position to resume after. Sort names the ordering the cursor
// was minted for (e.g. "created_at:desc"), so a token from one ordering is
// rejected — not silently misapplied — when replayed against another. Key is
// the value of the ordering column of the last row returned (microsecond
// precision, matching Postgres timestamptz) and ID is its tiebreaker.
type Cursor struct {
	Sort string
	Key  time.Time
	ID   ids.ID
}

// Encode produces the opaque token returned to clients. Clients must treat it
// as a black box; the format may change (the leading version field exists for
// that) without a breaking API change.
func (c Cursor) Encode() string {
	raw := strings.Join([]string{
		cursorVersion,
		c.Sort,
		strconv.FormatInt(c.Key.UnixMicro(), 10),
		c.ID.String(),
	}, "|")
	return base64.RawURLEncoding.EncodeToString([]byte(raw))
}

// Decode parses a token previously produced by Encode. An empty token is the
// first page and yields (nil, nil). wantSort is the ordering of the current
// request; a token minted for a different ordering is an error.
func Decode(token, wantSort string) (*Cursor, error) {
	if token == "" {
		return nil, nil
	}
	raw, err := base64.RawURLEncoding.DecodeString(token)
	if err != nil {
		return nil, fmt.Errorf("pagination: malformed cursor: %w", err)
	}
	parts := strings.Split(string(raw), "|")
	if len(parts) != 4 || parts[0] != cursorVersion {
		return nil, fmt.Errorf("pagination: unsupported cursor")
	}
	if parts[1] != wantSort {
		return nil, fmt.Errorf("pagination: cursor was issued for a different sort order")
	}
	micros, err := strconv.ParseInt(parts[2], 10, 64)
	if err != nil {
		return nil, fmt.Errorf("pagination: malformed cursor: %w", err)
	}
	id, err := ids.Parse(parts[3])
	if err != nil {
		return nil, fmt.Errorf("pagination: malformed cursor: %w", err)
	}
	return &Cursor{Sort: parts[1], Key: time.UnixMicro(micros).UTC(), ID: id}, nil
}

// ClampLimit normalizes a client-supplied page size to a safe range.
func ClampLimit(limit int32) int32 {
	if limit <= 0 {
		return DefaultLimit
	}
	if limit > MaxLimit {
		return MaxLimit
	}
	return limit
}

// Page is one page of results plus the cursor for the next one.
type Page[T any] struct {
	Items []T
	// Next is nil when there are no more results.
	Next *Cursor
}

// NewPage turns the limit+1 rows a keyset query fetched into a Page: if more
// than limit rows came back there is a next page, its cursor is derived from
// the last item kept via cursorOf, and the sentinel extra row is dropped.
func NewPage[T any](rows []T, limit int, cursorOf func(T) Cursor) Page[T] {
	if len(rows) <= limit {
		return Page[T]{Items: rows}
	}
	items := rows[:limit]
	next := cursorOf(items[limit-1])
	return Page[T]{Items: items, Next: &next}
}
