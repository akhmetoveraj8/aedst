-- name: CreateMedia :one
INSERT INTO media.media (id, owner_id, kind, status, filename, content_type, declared_size, object_key, sha256, task_id, created_at, updated_at)
VALUES ($1, $2, $3, 'pending_upload', $4, $5, $6, $7, $8, $9, $10, $10)
RETURNING *;

-- name: GetMedia :one
SELECT * FROM media.media WHERE id = $1 AND owner_id = $2;

-- name: GetMediaByID :one
SELECT * FROM media.media WHERE id = $1;

-- name: StartProcessing :one
-- Guarded: only a pending upload moves to processing (CompleteUpload retried
-- or raced by two devices runs once).
UPDATE media.media
SET status = 'processing', size_bytes = sqlc.arg(size_bytes), updated_at = sqlc.arg(now), version = version + 1
WHERE id = sqlc.arg(id) AND owner_id = sqlc.arg(owner_id) AND status = 'pending_upload'
RETURNING *;

-- name: MarkReady :one
-- Guarded: only a processing row becomes ready, so the MediaReady event is
-- written once even if the job is retried after this commit.
UPDATE media.media
SET status = 'ready', width = sqlc.arg(width), height = sqlc.arg(height), duration_ms = sqlc.arg(duration_ms),
    updated_at = sqlc.arg(now), version = version + 1
WHERE id = sqlc.arg(id) AND status = 'processing'
RETURNING *;

-- name: MarkFailed :execrows
UPDATE media.media
SET status = 'failed', failure_reason = sqlc.arg(reason), updated_at = sqlc.arg(now), version = version + 1
WHERE id = sqlc.arg(id) AND status IN ('pending_upload', 'processing');

-- name: UpsertVariant :exec
INSERT INTO media.variants (media_id, kind, object_key, content_type, width, height, size_bytes)
VALUES ($1, $2, $3, $4, $5, $6, $7)
ON CONFLICT (media_id, kind) DO UPDATE
SET object_key = EXCLUDED.object_key, content_type = EXCLUDED.content_type,
    width = EXCLUDED.width, height = EXCLUDED.height, size_bytes = EXCLUDED.size_bytes;

-- name: ListVariants :many
SELECT * FROM media.variants WHERE media_id = ANY (sqlc.arg(media_ids)::uuid[]) ORDER BY media_id, kind;

-- name: DeleteMedia :one
DELETE FROM media.media WHERE id = $1 AND owner_id = $2
RETURNING id, object_key, version;

-- name: ListMediaPage :many
SELECT * FROM media.media
WHERE owner_id = sqlc.arg(owner_id)
  AND (sqlc.narg(task_id)::uuid IS NULL OR task_id = sqlc.narg(task_id)::uuid)
  AND (cardinality(sqlc.arg(kinds)::text[]) = 0 OR kind = ANY (sqlc.arg(kinds)::text[]))
  AND (created_at, id) < (sqlc.arg(cursor_key)::timestamptz, sqlc.arg(cursor_id)::uuid)
ORDER BY created_at DESC, id DESC
LIMIT sqlc.arg(page_limit);

-- name: ClaimAbandonedUploads :many
-- Abandoned PENDING_UPLOAD rows (retention); SKIP LOCKED so concurrent
-- purges never fight over a row.
SELECT m.id, m.object_key FROM media.media m
WHERE m.status = 'pending_upload' AND m.created_at < sqlc.arg(cutoff)::timestamptz
ORDER BY m.created_at
LIMIT sqlc.arg(row_limit)::int
FOR UPDATE SKIP LOCKED;

-- name: DeleteMediaByIDs :execrows
DELETE FROM media.media WHERE id = ANY (sqlc.arg(ids)::uuid[]) AND status = 'pending_upload';

-- name: MediaTotals :one
SELECT count(*) AS total, coalesce(sum(size_bytes), 0)::bigint AS bytes FROM media.media WHERE status = 'ready';
