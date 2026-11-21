-- +goose Up
CREATE SCHEMA IF NOT EXISTS webhooks;

-- Registered receivers of outbound webhooks (operator-managed, so the table is
-- small). secret_ciphertext is the signing secret sealed with AES-256-GCM
-- (key version byte, nonce, ciphertext; the endpoint id is the additional
-- data): HMAC signing needs the secret in clear, so it cannot be hashed.
-- Closed sets are TEXT with a named CHECK, not ENUM types.
CREATE TABLE webhooks.endpoints (
    id                   UUID        PRIMARY KEY,
    url                  TEXT        NOT NULL,
    description          TEXT        NOT NULL DEFAULT '',
    event_types          TEXT[]      NOT NULL,
    secret_ciphertext    BYTEA       NOT NULL,
    status               TEXT        NOT NULL DEFAULT 'active',
    consecutive_failures INTEGER     NOT NULL DEFAULT 0,
    disabled_reason      TEXT        NOT NULL DEFAULT '',
    created_at           TIMESTAMPTZ NOT NULL,
    updated_at           TIMESTAMPTZ NOT NULL,
    CONSTRAINT endpoints_status_check CHECK (status IN ('active', 'disabled')),
    CONSTRAINT endpoints_disabled_reason_check CHECK (disabled_reason IN ('', 'operator', 'consecutive_failures')),
    CONSTRAINT endpoints_consecutive_failures_check CHECK (consecutive_failures >= 0),
    CONSTRAINT endpoints_event_types_check CHECK (cardinality(event_types) BETWEEN 1 AND 32)
);

-- Keyset list, newest first.
CREATE INDEX idx_webhooks_endpoints_created ON webhooks.endpoints (created_at DESC, id DESC);
-- Fan-out reads only the active endpoints.
CREATE INDEX idx_webhooks_endpoints_active ON webhooks.endpoints (id) WHERE status = 'active';

-- The delivery log: one row per (endpoint, event). The UNIQUE constraint is
-- what makes the fan-out idempotent on a redelivered event. The foreign key
-- stays inside this schema; deleting an endpoint removes its log.
CREATE TABLE webhooks.deliveries (
    id               UUID        PRIMARY KEY,
    endpoint_id      UUID        NOT NULL REFERENCES webhooks.endpoints (id) ON DELETE CASCADE,
    event_id         UUID        NOT NULL,
    event_type       TEXT        NOT NULL,
    payload          JSONB       NOT NULL,
    status           TEXT        NOT NULL DEFAULT 'pending',
    attempts         INTEGER     NOT NULL DEFAULT 0,
    last_status_code INTEGER     NOT NULL DEFAULT 0,
    last_error       TEXT        NOT NULL DEFAULT '',
    created_at       TIMESTAMPTZ NOT NULL,
    updated_at       TIMESTAMPTZ NOT NULL,
    delivered_at     TIMESTAMPTZ,
    CONSTRAINT deliveries_endpoint_event_key UNIQUE (endpoint_id, event_id),
    CONSTRAINT deliveries_status_check CHECK (status IN ('pending', 'delivered', 'failed', 'cancelled')),
    CONSTRAINT deliveries_attempts_check CHECK (attempts >= 0)
);

-- Keyset list of one endpoint's deliveries, newest first.
CREATE INDEX idx_webhooks_deliveries_endpoint_created ON webhooks.deliveries (endpoint_id, created_at DESC, id DESC);
-- Retention purge by age.
CREATE INDEX idx_webhooks_deliveries_created_at ON webhooks.deliveries (created_at);

-- +goose Down
DROP TABLE webhooks.deliveries;
DROP TABLE webhooks.endpoints;
DROP SCHEMA webhooks;
