-- +goose Up
CREATE SCHEMA IF NOT EXISTS search;

-- pg_trgm (Suggest, typo tolerance). Shared extension in `public`; the tasks
-- module may already have created it.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- The search projection: one row per searchable entity of another module,
-- built ONLY from integration events (never by reading another schema).
-- version orders out-of-order deliveries (newest wins); a deleted row is kept
-- as a tombstone (deleted = true) so a late, older snapshot cannot resurrect
-- it. Tombstones are purged by retention.
CREATE TABLE search.documents (
    kind       TEXT        NOT NULL,
    entity_id  UUID        NOT NULL,
    owner_id   UUID        NOT NULL,
    title      TEXT        NOT NULL DEFAULT '',
    body       TEXT        NOT NULL DEFAULT '',
    link       TEXT        NOT NULL DEFAULT '',
    version    INTEGER     NOT NULL,
    deleted    BOOLEAN     NOT NULL DEFAULT false,
    updated_at TIMESTAMPTZ NOT NULL,
    -- 'simple' configuration: no language-specific stemming, so it behaves
    -- the same for every language the product's users write in. Title
    -- outranks body (weights A and B).
    tsv        TSVECTOR GENERATED ALWAYS AS (
        setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
        setweight(to_tsvector('simple', coalesce(body, '')), 'B')
    ) STORED,
    PRIMARY KEY (kind, entity_id)
);

-- Full-text matching (caller-scoped: owner_id is filtered in every query).
CREATE INDEX idx_search_documents_tsv ON search.documents USING gin (tsv);
-- Owner filter + recency.
CREATE INDEX idx_search_documents_owner ON search.documents (owner_id, updated_at, entity_id)
    WHERE NOT deleted;
-- Suggest (prefix / word similarity on titles).
CREATE INDEX idx_search_documents_title_trgm ON search.documents USING gin (title gin_trgm_ops);
-- Retention of tombstones.
CREATE INDEX idx_search_documents_tombstones ON search.documents (updated_at)
    WHERE deleted;

-- +goose Down
DROP TABLE search.documents;
DROP SCHEMA search;
