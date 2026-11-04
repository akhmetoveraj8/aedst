-- +goose Up

-- ADR-0019: first-party authentication was removed. The server is a pure OIDC
-- resource server: identities and credentials live in the identity provider and
-- this schema has no readers or writers left. Run the migration only after the
-- users have been moved to the provider (docs/content/server/runbook.md,
-- "Removing first-party auth"): the dropped data is not recoverable from here
-- (restore a backup to get it back). IF EXISTS keeps the migration re-runnable
-- on a database where the schema was already dropped by hand.
--
-- No FK points at auth.* from another schema (modules never reference another
-- module's tables), so nothing else is affected. pg_trgm stays: other modules
-- use it.

-- squawk-ignore ban-drop-table
DROP TABLE IF EXISTS auth.sessions;
-- squawk-ignore ban-drop-table
DROP TABLE IF EXISTS auth.credentials;
DROP SCHEMA IF EXISTS auth;

-- +goose Down
-- Recreates the empty structure only (migrations 00001-00003); the data is gone.
CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE auth.credentials (
    user_id       UUID PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE auth.sessions (
    id                  UUID PRIMARY KEY,
    user_id             UUID NOT NULL REFERENCES auth.credentials (user_id),
    device_id           TEXT NOT NULL,
    refresh_token_hash  TEXT NOT NULL,
    expires_at          TIMESTAMPTZ NOT NULL,
    revoked_at          TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_auth_sessions_user_id ON auth.sessions (user_id);
CREATE INDEX idx_auth_sessions_expires_at ON auth.sessions (expires_at);
CREATE INDEX idx_auth_sessions_revoked_at ON auth.sessions (revoked_at) WHERE revoked_at IS NOT NULL;
CREATE INDEX idx_auth_credentials_created_keyset ON auth.credentials (created_at, user_id);
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX idx_auth_credentials_email_trgm ON auth.credentials USING gin (email gin_trgm_ops);
