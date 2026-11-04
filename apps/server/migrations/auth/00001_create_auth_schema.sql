-- +goose Up
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

-- +goose Down
DROP TABLE auth.sessions;
DROP TABLE auth.credentials;
DROP SCHEMA auth;
