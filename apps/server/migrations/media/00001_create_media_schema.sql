-- +goose Up
CREATE SCHEMA IF NOT EXISTS media;

-- One uploaded file. Bytes live in object storage (object_key); this row is
-- the metadata and the state machine:
--   pending_upload -> processing -> ready | failed
-- Every transition is a guarded UPDATE (WHERE status = ...), so a retried
-- CompleteUpload or processing job cannot act twice. task_id is the optional
-- attachment target, owned by owner_id (checked through tasks/api; no FK
-- across schemas).
CREATE TABLE media.media (
    id             UUID PRIMARY KEY,
    owner_id       UUID        NOT NULL,
    kind           TEXT        NOT NULL CHECK (kind IN ('image', 'video', 'audio', 'document')),
    status         TEXT        NOT NULL CHECK (status IN ('pending_upload', 'processing', 'ready', 'failed')),
    filename       TEXT        NOT NULL,
    content_type   TEXT        NOT NULL,
    declared_size  BIGINT      NOT NULL,
    size_bytes     BIGINT      NOT NULL DEFAULT 0,
    width          INTEGER     NOT NULL DEFAULT 0,
    height         INTEGER     NOT NULL DEFAULT 0,
    duration_ms    BIGINT      NOT NULL DEFAULT 0,
    object_key     TEXT        NOT NULL UNIQUE,
    sha256         TEXT        NOT NULL DEFAULT '',
    task_id        UUID,
    failure_reason TEXT        NOT NULL DEFAULT '',
    version        INTEGER     NOT NULL DEFAULT 1,
    created_at     TIMESTAMPTZ NOT NULL,
    updated_at     TIMESTAMPTZ NOT NULL
);

-- Keyset listing of an owner's media, newest first.
CREATE INDEX idx_media_owner_created_keyset ON media.media (owner_id, created_at, id);
-- A task's attachments.
CREATE INDEX idx_media_owner_task ON media.media (owner_id, task_id, created_at, id)
    WHERE task_id IS NOT NULL;
-- Retention of abandoned uploads.
CREATE INDEX idx_media_pending_created ON media.media (created_at)
    WHERE status = 'pending_upload';

-- Derived renditions produced by processing.
CREATE TABLE media.variants (
    media_id     UUID        NOT NULL REFERENCES media.media (id) ON DELETE CASCADE,
    kind         TEXT        NOT NULL CHECK (kind IN ('thumbnail', 'preview', 'optimized', 'poster')),
    object_key   TEXT        NOT NULL UNIQUE,
    content_type TEXT        NOT NULL,
    width        INTEGER     NOT NULL DEFAULT 0,
    height       INTEGER     NOT NULL DEFAULT 0,
    size_bytes   BIGINT      NOT NULL DEFAULT 0,
    PRIMARY KEY (media_id, kind)
);

-- +goose Down
DROP TABLE media.variants;
DROP TABLE media.media;
DROP SCHEMA media;
