-- +goose Up

-- Tables shared by every module and owned by internal/platform. Integration
-- events are River jobs inserted in the producer's transaction (ADR-0014): river_job
-- is the outbox, so there is no outbox or inbox table here.
CREATE SCHEMA IF NOT EXISTS platform;

-- Command idempotency (see internal/platform/idempotency). scope namespaces the
-- key (module + caller), so two users can never collide on, or probe, each
-- other's keys. request_hash guards against key reuse for a different request.
CREATE TABLE platform.idempotency_keys (
    scope        TEXT        NOT NULL,
    key          TEXT        NOT NULL,
    request_hash TEXT        NOT NULL,
    result       BYTEA       NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (scope, key)
);

CREATE INDEX idx_platform_idempotency_created_at ON platform.idempotency_keys (created_at);

-- +goose Down
DROP TABLE platform.idempotency_keys;
DROP SCHEMA platform;
