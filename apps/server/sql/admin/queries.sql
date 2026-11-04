-- name: InsertAuditEntry :exec
INSERT INTO admin.audit_log (id, actor_id, actor_subject, actor_issuer, action, target_kind, target_id, reason, metadata, created_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10);

-- name: ListAuditEntries :many
SELECT id, actor_id, actor_subject, actor_issuer, action, target_kind, target_id, reason, metadata, created_at
FROM admin.audit_log
WHERE (created_at, id) < (sqlc.arg(cursor_key)::timestamptz, sqlc.arg(cursor_id)::uuid)
ORDER BY created_at DESC, id DESC
LIMIT sqlc.arg(page_limit);

-- name: PurgeAuditEntries :execrows
DELETE FROM admin.audit_log
WHERE id IN (
    SELECT a.id FROM admin.audit_log a
    WHERE a.created_at < sqlc.arg(cutoff)::timestamptz
    LIMIT sqlc.arg(row_limit)::int
);
