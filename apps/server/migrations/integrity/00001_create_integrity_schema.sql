-- +goose Up
CREATE SCHEMA IF NOT EXISTS integrity;

-- Replay protection for Play Integrity tokens: one row per verified token,
-- keyed by SHA-256 of the token (the token itself is never stored). The
-- PRIMARY KEY is what makes a second verification of the same token lose,
-- across every replica. Rows only need to outlive the freshness window of the
-- policy (an older token is rejected as expired anyway); retention purges them.
CREATE TABLE integrity.verified_tokens (
    token_hash  BYTEA       PRIMARY KEY,
    user_id     UUID        NOT NULL,
    verified_at TIMESTAMPTZ NOT NULL
);

-- Retention purge by age.
CREATE INDEX idx_integrity_verified_tokens_verified_at ON integrity.verified_tokens (verified_at);

-- +goose Down
DROP TABLE integrity.verified_tokens;
DROP SCHEMA integrity;
