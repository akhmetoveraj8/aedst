// Package postgres implements the search projection on PostgreSQL full-text
// search (tsvector + websearch_to_tsquery + ts_headline) and pg_trgm.
package postgres

import (
	"context"
	"math"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	searchdb "github.com/aedst/server/gen/db/search"
	"github.com/aedst/server/internal/modules/search/application"
	"github.com/aedst/server/internal/modules/search/domain"
	sharederrors "github.com/aedst/server/internal/shared/errors"
	"github.com/aedst/server/internal/shared/ids"
	"github.com/aedst/server/internal/shared/like"
)

// headlineOptions makes ts_headline wrap matches in the private-use markers
// the API promises (search.proto SearchHit.snippet) instead of HTML.
var headlineOptions = `StartSel="` + domain.HighlightStart + `", StopSel="` + domain.HighlightStop +
	`", MaxWords=30, MinWords=10, MaxFragments=2, FragmentDelimiter=" … "`

type Repository struct {
	pool *pgxpool.Pool
}

func NewRepository(pool *pgxpool.Pool) *Repository { return &Repository{pool: pool} }

var _ application.Repository = (*Repository)(nil)

func (r *Repository) Search(ctx context.Context, p application.SearchParams) ([]domain.Hit, error) {
	cursorRank, cursorID := math.MaxFloat64, pgtype.UUID{Bytes: [16]byte{0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff}, Valid: true}
	if p.After != nil {
		cursorRank, cursorID = p.After.Score, toPgUUID(p.After.ID)
	}
	rows, err := searchdb.New(r.pool).SearchDocuments(ctx, searchdb.SearchDocumentsParams{
		HeadlineOptions: headlineOptions,
		CursorRank:      cursorRank,
		CursorID:        cursorID,
		PageLimit:       int32(p.Limit),
		Query:           p.Query,
		OwnerID:         toPgUUID(p.OwnerID),
		Kinds:           kindStrings(p.Kinds),
	})
	if err != nil {
		return nil, sharederrors.Wrap("search.Search", err)
	}
	hits := make([]domain.Hit, len(rows))
	for i, row := range rows {
		hits[i] = domain.Hit{
			Kind:      domain.Kind(row.Kind),
			EntityID:  ids.ID(row.EntityID.Bytes),
			Title:     row.Title,
			Snippet:   row.Snippet,
			Score:     row.Rank,
			Link:      row.Link,
			UpdatedAt: row.UpdatedAt.Time,
		}
	}
	return hits, nil
}

func (r *Repository) CountMatches(ctx context.Context, p application.SearchParams, limit int) (int, error) {
	n, err := searchdb.New(r.pool).CountSearchMatches(ctx, searchdb.CountSearchMatchesParams{
		OwnerID: toPgUUID(p.OwnerID), Query: p.Query, Kinds: kindStrings(p.Kinds), Cap: int32(limit),
	})
	if err != nil {
		return 0, sharederrors.Wrap("search.CountMatches", err)
	}
	return int(n), nil
}

func (r *Repository) Suggest(ctx context.Context, ownerID ids.ID, prefix string, limit int) ([]string, error) {
	out, err := searchdb.New(r.pool).SuggestTitles(ctx, searchdb.SuggestTitlesParams{
		PrefixPattern: like.Escape(prefix) + "%",
		Prefix:        prefix,
		OwnerID:       toPgUUID(ownerID),
		RowLimit:      int32(limit),
	})
	if err != nil {
		return nil, sharederrors.Wrap("search.Suggest", err)
	}
	return out, nil
}

// Upsert stores d inside tx (the consumer's delivery transaction) if it is newer
// than what is stored.
func (r *Repository) Upsert(ctx context.Context, tx pgx.Tx, d domain.Document) error {
	_, err := searchdb.New(tx).UpsertDocument(ctx, searchdb.UpsertDocumentParams{
		Kind:      string(d.Kind),
		EntityID:  toPgUUID(d.EntityID),
		OwnerID:   toPgUUID(d.OwnerID),
		Title:     d.Title,
		Body:      domain.TruncateBody(d.Body),
		Link:      d.Link,
		Version:   int32(d.Version),
		UpdatedAt: pgtype.Timestamptz{Time: d.UpdatedAt, Valid: true},
	})
	if err != nil {
		return sharederrors.Wrap("search.Upsert", err)
	}
	return nil
}

// Tombstone marks an entity deleted at version (newer than any snapshot).
func (r *Repository) Tombstone(ctx context.Context, tx pgx.Tx, kind domain.Kind, entityID, ownerID ids.ID, version int, at time.Time) error {
	_, err := searchdb.New(tx).TombstoneDocument(ctx, searchdb.TombstoneDocumentParams{
		Kind:      string(kind),
		EntityID:  toPgUUID(entityID),
		OwnerID:   toPgUUID(ownerID),
		Version:   int32(version),
		UpdatedAt: pgtype.Timestamptz{Time: at, Valid: true},
	})
	if err != nil {
		return sharederrors.Wrap("search.Tombstone", err)
	}
	return nil
}

// PurgeTombstones deletes up to limit tombstones older than cutoff. The
// cutoff must exceed the event redelivery window (River's retry backoff), or a late old snapshot
// could resurrect a deleted document (retention is configured accordingly).
func (r *Repository) PurgeTombstones(ctx context.Context, cutoff time.Time, limit int) (int64, error) {
	n, err := searchdb.New(r.pool).PurgeTombstones(ctx, searchdb.PurgeTombstonesParams{
		Cutoff: pgtype.Timestamptz{Time: cutoff, Valid: true}, RowLimit: int32(limit),
	})
	if err != nil {
		return 0, sharederrors.Wrap("search.PurgeTombstones", err)
	}
	return n, nil
}

func kindStrings(kinds []domain.Kind) []string {
	out := make([]string, len(kinds))
	for i, k := range kinds {
		out[i] = string(k)
	}
	return out
}

func toPgUUID(id ids.ID) pgtype.UUID { return pgtype.UUID{Bytes: id, Valid: !id.IsNil()} }
