-- +goose Up
CREATE SCHEMA IF NOT EXISTS tasks;

-- Substring search (ILIKE '%term%') cannot use a b-tree; trigram GIN indexes
-- make it index-assisted. The extension lives in `public`, shared by every
-- module that needs fuzzy search.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TYPE tasks.status AS ENUM ('todo', 'in_progress', 'done');
CREATE TYPE tasks.priority AS ENUM ('low', 'medium', 'high', 'urgent');

-- No FK from user_id to auth.credentials: modules never reference another
-- module's schema, not even via FK (see docs/content/server/database.md) — a cross-schema
-- FK would be the same coupling a cross-schema JOIN is, just enforced by a
-- constraint instead of a query. Validity of user_id comes from the JWT
-- AuthInterceptor already verified before a handler ever runs.
CREATE TABLE tasks.tasks (
    id           UUID PRIMARY KEY,
    user_id      UUID NOT NULL,
    title        TEXT NOT NULL,
    description  TEXT NOT NULL DEFAULT '',
    status       tasks.status NOT NULL DEFAULT 'todo',
    priority     tasks.priority NOT NULL,
    due_date     TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Optimistic concurrency: every mutation bumps version, and UpdateTask can
    -- require the version the client last saw.
    version      INTEGER NOT NULL DEFAULT 1,
    -- The invariants the domain enforces, also held by the table so no other
    -- writer can break them: a title has 1..200 characters (domain.MaxTitleLength,
    -- counted in runes); a task is done exactly when it has a completion time
    -- (CompleteTask and ReopenTask are the only writers of status); version >= 1.
    CONSTRAINT tasks_title_length CHECK (char_length(title) BETWEEN 1 AND 200),
    CONSTRAINT tasks_done_has_completed_at CHECK ((status = 'done') = (completed_at IS NOT NULL)),
    CONSTRAINT tasks_version_positive CHECK (version >= 1)
);

-- Backs ListTasks filtered by status and the dashboard's per-status counts.
CREATE INDEX idx_tasks_user_id_status ON tasks.tasks (user_id, status);

-- Keyset pagination (see internal/shared/pagination) orders by (sort key, id)
-- in one direction, so the index columns must all share that direction; a plain
-- ascending index is scanned in either direction.
CREATE INDEX idx_tasks_user_created_keyset ON tasks.tasks (user_id, created_at, id);

-- Backs ListTasks ordered by due date. Tasks without a due date sort as the
-- earliest instant (see sql/tasks/queries.sql: sentinel) so the ordering is
-- total and keyset-comparable. to_timestamp(double precision) is IMMUTABLE,
-- which an expression index requires.
CREATE INDEX idx_tasks_user_due_keyset ON tasks.tasks (user_id, (COALESCE(due_date, to_timestamp(-62135596800))), id);

-- Trigram indexes for substring search over title and description.
CREATE INDEX idx_tasks_title_trgm ON tasks.tasks USING gin (title gin_trgm_ops);
CREATE INDEX idx_tasks_description_trgm ON tasks.tasks USING gin (description gin_trgm_ops);

-- Backs the operator listing across all owners (AdminService.ListTasks, keyset
-- on (created_at, id) newest first). Every per-user query already has
-- user_id-leading indexes; this one serves only the cross-tenant admin read.
CREATE INDEX idx_tasks_created_keyset ON tasks.tasks (created_at, id);

-- One row per (task, due date) a TaskDueSoon event was published for. The
-- reminder job inserts it in the same transaction as the event with
-- ON CONFLICT DO NOTHING RETURNING, so a retried job can never publish a second
-- event for the same due date (the "guarded in SQL" rule). Rows go with their
-- task (same schema, so a foreign key is fine).
CREATE TABLE tasks.due_soon_marks (
    task_id   UUID        NOT NULL REFERENCES tasks.tasks (id) ON DELETE CASCADE,
    due_date  TIMESTAMPTZ NOT NULL,
    marked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (task_id, due_date)
);

-- +goose Down
DROP TABLE tasks.due_soon_marks;
DROP TABLE tasks.tasks;
DROP TYPE tasks.priority;
DROP TYPE tasks.status;
DROP SCHEMA tasks;
