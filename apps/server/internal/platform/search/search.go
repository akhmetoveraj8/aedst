// Package search is the port to the search engine (Meilisearch) and the River
// job that keeps its indexes in step with PostgreSQL.
//
// PostgreSQL is the source of truth; the engine is a derived, rebuildable
// projection. Correctness never depends on it: a module serves simple lookups
// from pg_trgm (see AGENTS.md, "When you add a list that can grow") and uses
// the engine only for typo-tolerant, ranked, multi-field search. Indexing never
// happens synchronously from a request: the write path inserts an index job in
// the same transaction as the state change (Indexer.EnqueueTx), and a River
// worker loads the current row through the module's Source and pushes it. A
// job carries only (index, id), so retries and out-of-order runs converge on
// the row's current state.
//
// The official client github.com/meilisearch/meilisearch-go is imported only in
// meili.go. Domain and application code depend on Engine, never on the client.
package search

import (
	"context"
	"errors"
)

// Document is one indexed record. It must carry a string "id": the primary key.
type Document map[string]any

// Query is a search request.
type Query struct {
	Text   string
	Limit  int // 0 = engine default
	Offset int
	// Filter is a Meilisearch filter expression over filterable attributes
	// (empty = none). Build it from trusted fragments only; escape user input.
	Filter string
}

// Result is a page of hits, best match first.
type Result struct {
	Hits []Document
	// Estimated is the engine's estimate of all matches, not an exact count.
	Estimated int64
}

// Engine is the search port.
type Engine interface {
	// Upsert adds or replaces documents. The engine applies it asynchronously:
	// success means accepted, not yet searchable.
	Upsert(ctx context.Context, index string, docs []Document) error
	// Delete removes documents by id; unknown ids are not an error.
	Delete(ctx context.Context, index string, ids []string) error
	Search(ctx context.Context, index string, q Query) (Result, error)
	// Ping reports whether the engine answers (readiness, optional check).
	Ping(ctx context.Context) error
}

// ErrDisabled is returned by the Disabled engine: search is not configured, so
// callers fall back to pg_trgm.
var ErrDisabled = errors.New("search: not configured")

// Disabled is the Engine used when AEDST_SEARCH_URL is empty.
type Disabled struct{}

func (Disabled) Upsert(context.Context, string, []Document) error { return ErrDisabled }
func (Disabled) Delete(context.Context, string, []string) error   { return ErrDisabled }
func (Disabled) Search(context.Context, string, Query) (Result, error) {
	return Result{}, ErrDisabled
}
func (Disabled) Ping(context.Context) error { return ErrDisabled }
