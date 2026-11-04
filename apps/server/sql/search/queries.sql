-- name: UpsertDocument :execrows
-- Newest version wins; a tombstone is never overwritten by an older snapshot
-- and an equal-or-older event changes nothing (at-least-once, unordered delivery).
INSERT INTO search.documents (kind, entity_id, owner_id, title, body, link, version, deleted, updated_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, false, $8)
ON CONFLICT (kind, entity_id) DO UPDATE
SET owner_id   = EXCLUDED.owner_id,
    title      = EXCLUDED.title,
    body       = EXCLUDED.body,
    link       = EXCLUDED.link,
    version    = EXCLUDED.version,
    deleted    = false,
    updated_at = EXCLUDED.updated_at
WHERE search.documents.version < EXCLUDED.version;

-- name: TombstoneDocument :execrows
INSERT INTO search.documents (kind, entity_id, owner_id, version, deleted, updated_at)
VALUES ($1, $2, $3, $4, true, $5)
ON CONFLICT (kind, entity_id) DO UPDATE
SET title      = '',
    body       = '',
    version    = EXCLUDED.version,
    deleted    = true,
    updated_at = EXCLUDED.updated_at
WHERE search.documents.version < EXCLUDED.version;

-- name: SearchDocuments :many
-- Ranked keyset page: order by (rank DESC, entity_id DESC); the cursor is the
-- last row's (rank, entity_id). rank is cast to float8 so it round-trips
-- exactly through the page token.
WITH q AS (SELECT websearch_to_tsquery('simple', sqlc.arg(query)::text) AS tsq),
ranked AS (
    SELECT d.kind, d.entity_id, d.title, d.body, d.link, d.updated_at,
           ts_rank_cd(d.tsv, q.tsq)::float8 AS rank, q.tsq
    FROM search.documents d, q
    WHERE d.owner_id = sqlc.arg(owner_id)
      AND NOT d.deleted
      AND d.tsv @@ q.tsq
      AND (cardinality(sqlc.arg(kinds)::text[]) = 0 OR d.kind = ANY (sqlc.arg(kinds)::text[]))
)
SELECT kind, entity_id, title, link, updated_at, rank,
       ts_headline('simple', CASE WHEN body = '' THEN title ELSE body END, tsq, sqlc.arg(headline_options)::text)::text AS snippet
FROM ranked
WHERE (rank, entity_id) < (sqlc.arg(cursor_rank)::float8, sqlc.arg(cursor_id)::uuid)
ORDER BY rank DESC, entity_id DESC
LIMIT sqlc.arg(page_limit);

-- name: CountSearchMatches :one
-- Approximate total for the first page, capped so it stays cheap.
SELECT count(*)::int FROM (
    SELECT 1 FROM search.documents d
    WHERE d.owner_id = sqlc.arg(owner_id)
      AND NOT d.deleted
      AND d.tsv @@ websearch_to_tsquery('simple', sqlc.arg(query)::text)
      AND (cardinality(sqlc.arg(kinds)::text[]) = 0 OR d.kind = ANY (sqlc.arg(kinds)::text[]))
    LIMIT sqlc.arg(cap)::int
) capped;

-- name: SuggestTitles :many
-- Prefix matches first, then trigram word-similarity (typo tolerance).
SELECT title FROM (
    SELECT d.title,
           max(CASE WHEN d.title ILIKE sqlc.arg(prefix_pattern)::text THEN 1 ELSE 0 END) AS prefix_hit,
           max(word_similarity(sqlc.arg(prefix)::text, d.title)) AS sim
    FROM search.documents d
    WHERE d.owner_id = sqlc.arg(owner_id)
      AND NOT d.deleted
      AND (d.title ILIKE sqlc.arg(prefix_pattern)::text OR sqlc.arg(prefix)::text <% d.title)
    GROUP BY d.title
) s
ORDER BY prefix_hit DESC, sim DESC, title
LIMIT sqlc.arg(row_limit)::int;

-- name: PurgeTombstones :execrows
DELETE FROM search.documents
WHERE (kind, entity_id) IN (
    SELECT d.kind, d.entity_id FROM search.documents d
    WHERE d.deleted AND d.updated_at < sqlc.arg(cutoff)::timestamptz
    LIMIT sqlc.arg(row_limit)::int
);
