-- +goose Up
CREATE SCHEMA IF NOT EXISTS appattest;

-- Single-use server challenges for Apple App Attest enrollment. Correctness
-- state, so Postgres and not Valkey: the UPDATE ... WHERE consumed_at IS NULL in
-- ConsumeChallenge is what makes a challenge usable exactly once across every
-- replica. A challenge is bound to the user it was issued to. Rows are purged
-- by retention shortly after they expire.
CREATE TABLE appattest.challenges (
    id          UUID        PRIMARY KEY,
    user_id     UUID        NOT NULL,
    challenge   BYTEA       NOT NULL UNIQUE,
    expires_at  TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ
);

-- Retention purge by age.
CREATE INDEX idx_appattest_challenges_expires_at ON appattest.challenges (expires_at);

-- Attested App Attest keys. key_id is the raw 32-byte SHA-256 of the
-- uncompressed public key (the base64 string the client sends, decoded). The
-- public key is stored as PKIX DER. counter is the last accepted assertion
-- counter (0 right after enrollment); it only ever increases, enforced by the
-- compare-and-set in AdvanceCounter. A key belongs to exactly one user.
CREATE TABLE appattest.keys (
    key_id       BYTEA       PRIMARY KEY CHECK (octet_length(key_id) = 32),
    user_id      UUID        NOT NULL,
    bundle_id    TEXT        NOT NULL,
    public_key   BYTEA       NOT NULL,
    counter      BIGINT      NOT NULL DEFAULT 0 CHECK (counter >= 0 AND counter <= 4294967295),
    environment  TEXT        NOT NULL CHECK (environment IN ('production', 'development')),
    created_at   TIMESTAMPTZ NOT NULL,
    last_used_at TIMESTAMPTZ NOT NULL,
    revoked_at   TIMESTAMPTZ
);

-- Listing / revoking a user's keys.
CREATE INDEX idx_appattest_keys_user_id ON appattest.keys (user_id);
-- Retention purge of keys that were not used for a long time (the client re-enrolls).
CREATE INDEX idx_appattest_keys_last_used_at ON appattest.keys (last_used_at);

-- +goose Down
DROP TABLE appattest.keys;
DROP TABLE appattest.challenges;
DROP SCHEMA appattest;
