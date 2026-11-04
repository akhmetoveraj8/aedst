-- Declaration of the River tables the platform queries read, FOR sqlc ONLY.
-- This is not a migration: River owns and migrates its schema (rivermigrate,
-- internal/platform/jobs.Migrate). Keep it to the columns queries.sql uses.
CREATE TYPE river_job_state AS ENUM (
    'available', 'cancelled', 'completed', 'discarded', 'pending', 'retryable', 'running', 'scheduled'
);

CREATE TABLE river_job (
    id           BIGSERIAL PRIMARY KEY,
    state        river_job_state NOT NULL,
    scheduled_at TIMESTAMPTZ NOT NULL
);
