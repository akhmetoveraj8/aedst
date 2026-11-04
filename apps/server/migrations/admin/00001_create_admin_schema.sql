-- +goose Up
CREATE SCHEMA IF NOT EXISTS admin;

-- Append-only audit trail of operator actions. Each row is written in the
-- SAME transaction as the mutation it records (AdminService), so there is
-- never an action without its entry, nor an entry for a rolled-back action.
-- actor_id is the operator's owner id (platform/auth Identity.UserID);
-- actor_subject/issuer keep the IdP identity for investigations.
CREATE TABLE admin.audit_log (
    id            UUID PRIMARY KEY,
    actor_id      UUID        NOT NULL,
    actor_subject TEXT        NOT NULL DEFAULT '',
    actor_issuer  TEXT        NOT NULL DEFAULT '',
    action        TEXT        NOT NULL,
    target_kind   TEXT        NOT NULL,
    target_id     TEXT        NOT NULL DEFAULT '',
    reason        TEXT        NOT NULL DEFAULT '',
    metadata      JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_at    TIMESTAMPTZ NOT NULL
);

-- Keyset listing (newest first) and retention by age.
CREATE INDEX idx_audit_log_created_keyset ON admin.audit_log (created_at, id);

-- +goose Down
DROP TABLE admin.audit_log;
DROP SCHEMA admin;
