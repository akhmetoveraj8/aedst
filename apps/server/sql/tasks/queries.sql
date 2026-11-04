-- name: CreateTask :one
INSERT INTO tasks.tasks (id, user_id, title, description, priority, due_date, created_at, updated_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
RETURNING id, user_id, title, description, status, priority, due_date, completed_at, created_at, updated_at, version;

-- name: FindTaskByIDAndUserID :one
SELECT id, user_id, title, description, status, priority, due_date, completed_at, created_at, updated_at, version
FROM tasks.tasks
WHERE id = $1 AND user_id = $2;

-- name: UpdateTask :one
-- Partial update of title/description/priority/due_date in ONE statement: a
-- NULL argument leaves the column unchanged (set_due_date says whether due_date
-- is being written, since NULL is also how it is cleared). Status is never set
-- here, see CompleteTask/ReopenTask (tasks.proto's UpdateTask doc comment
-- explains why). When expected_version is given the row must still be at that
-- version; no row back means "not found" or "version mismatch" and the caller
-- tells them apart.
UPDATE tasks.tasks
SET title       = COALESCE(sqlc.narg(title)::text, title),
    description = COALESCE(sqlc.narg(description)::text, description),
    priority    = COALESCE(sqlc.narg(priority)::text::tasks.priority, priority),
    due_date    = CASE WHEN sqlc.arg(set_due_date)::boolean THEN sqlc.narg(due_date)::timestamptz ELSE due_date END,
    updated_at  = sqlc.arg(updated_at),
    version     = version + 1
WHERE id = sqlc.arg(id)
  AND user_id = sqlc.arg(user_id)
  AND (sqlc.narg(expected_version)::integer IS NULL OR version = sqlc.narg(expected_version)::integer)
RETURNING id, user_id, title, description, status, priority, due_date, completed_at, created_at, updated_at, version;

-- name: CompleteTask :one
-- Guarded transition: only a task that is not yet done changes, so completing
-- twice (a retry, a double click, two devices) is a no-op instead of a second
-- state change and a second TaskCompleted event. No row back means "not found"
-- or "already done" and the caller tells them apart.
UPDATE tasks.tasks
SET status = 'done', completed_at = sqlc.arg(now), updated_at = sqlc.arg(now), version = version + 1
WHERE id = sqlc.arg(id) AND user_id = sqlc.arg(user_id) AND status <> 'done'
RETURNING id, user_id, title, description, status, priority, due_date, completed_at, created_at, updated_at, version;

-- name: ReopenTask :one
-- Guarded like CompleteTask: reopening a task that is already todo changes
-- nothing.
UPDATE tasks.tasks
SET status = 'todo', completed_at = NULL, updated_at = sqlc.arg(now), version = version + 1
WHERE id = sqlc.arg(id) AND user_id = sqlc.arg(user_id) AND status <> 'todo'
RETURNING id, user_id, title, description, status, priority, due_date, completed_at, created_at, updated_at, version;

-- name: DeleteTask :one
-- RETURNING the version lets the caller publish TaskDeleted with a version
-- above every earlier snapshot (projections apply newest-version-wins).
DELETE FROM tasks.tasks
WHERE id = $1 AND user_id = $2
RETURNING version;

-- Keyset-paginated listing (see internal/shared/pagination). One query per
-- sort order so each has a plain, index-friendly ORDER BY — a CASE-switched
-- ORDER BY cannot use any index. The cursor predicate is unconditional: on
-- the first page the caller passes an open-ended cursor (infinity for DESC,
-- -infinity for ASC) that every row satisfies, so there is no
-- `flag OR (...)` for the planner to mishandle in a generic plan.
--
-- Rows without a due date use a fixed sentinel (year 1) as their due sort
-- key: a total, non-NULL ordering that keeps `(key, id)` row comparison valid
-- and matches idx_tasks_user_due_keyset. It reproduces the earlier
-- NULLS FIRST (asc) / NULLS LAST (desc) behaviour.
--
-- Fetch page_limit+1 rows; the caller uses the extra row only to know whether
-- a next page exists. No count(*) here: counting the matching set is O(rows)
-- on every page. CountTasks below runs once, on the first page only.

-- name: ListTasksByCreatedDesc :many
SELECT id, user_id, title, description, status, priority, due_date, completed_at, created_at, updated_at, version
FROM tasks.tasks
WHERE user_id = sqlc.arg(user_id)
  AND (cardinality(sqlc.arg(statuses)::text[]::tasks.status[]) = 0 OR status = ANY (sqlc.arg(statuses)::text[]::tasks.status[]))
  AND (cardinality(sqlc.arg(priorities)::text[]::tasks.priority[]) = 0 OR priority = ANY (sqlc.arg(priorities)::text[]::tasks.priority[]))
  AND (sqlc.arg(search)::text = '' OR title ILIKE '%' || sqlc.arg(search) || '%' OR description ILIKE '%' || sqlc.arg(search) || '%')
  AND (created_at, id) < (sqlc.arg(cursor_key)::timestamptz, sqlc.arg(cursor_id)::uuid)
ORDER BY created_at DESC, id DESC
LIMIT sqlc.arg(page_limit);

-- name: ListTasksByCreatedAsc :many
SELECT id, user_id, title, description, status, priority, due_date, completed_at, created_at, updated_at, version
FROM tasks.tasks
WHERE user_id = sqlc.arg(user_id)
  AND (cardinality(sqlc.arg(statuses)::text[]::tasks.status[]) = 0 OR status = ANY (sqlc.arg(statuses)::text[]::tasks.status[]))
  AND (cardinality(sqlc.arg(priorities)::text[]::tasks.priority[]) = 0 OR priority = ANY (sqlc.arg(priorities)::text[]::tasks.priority[]))
  AND (sqlc.arg(search)::text = '' OR title ILIKE '%' || sqlc.arg(search) || '%' OR description ILIKE '%' || sqlc.arg(search) || '%')
  AND (created_at, id) > (sqlc.arg(cursor_key)::timestamptz, sqlc.arg(cursor_id)::uuid)
ORDER BY created_at ASC, id ASC
LIMIT sqlc.arg(page_limit);

-- name: ListTasksByDueDesc :many
SELECT id, user_id, title, description, status, priority, due_date, completed_at, created_at, updated_at, version
FROM tasks.tasks
WHERE user_id = sqlc.arg(user_id)
  AND (cardinality(sqlc.arg(statuses)::text[]::tasks.status[]) = 0 OR status = ANY (sqlc.arg(statuses)::text[]::tasks.status[]))
  AND (cardinality(sqlc.arg(priorities)::text[]::tasks.priority[]) = 0 OR priority = ANY (sqlc.arg(priorities)::text[]::tasks.priority[]))
  AND (sqlc.arg(search)::text = '' OR title ILIKE '%' || sqlc.arg(search) || '%' OR description ILIKE '%' || sqlc.arg(search) || '%')
  AND (COALESCE(due_date, to_timestamp(-62135596800)), id) < (sqlc.arg(cursor_key)::timestamptz, sqlc.arg(cursor_id)::uuid)
ORDER BY COALESCE(due_date, to_timestamp(-62135596800)) DESC, id DESC
LIMIT sqlc.arg(page_limit);

-- name: ListTasksByDueAsc :many
SELECT id, user_id, title, description, status, priority, due_date, completed_at, created_at, updated_at, version
FROM tasks.tasks
WHERE user_id = sqlc.arg(user_id)
  AND (cardinality(sqlc.arg(statuses)::text[]::tasks.status[]) = 0 OR status = ANY (sqlc.arg(statuses)::text[]::tasks.status[]))
  AND (cardinality(sqlc.arg(priorities)::text[]::tasks.priority[]) = 0 OR priority = ANY (sqlc.arg(priorities)::text[]::tasks.priority[]))
  AND (sqlc.arg(search)::text = '' OR title ILIKE '%' || sqlc.arg(search) || '%' OR description ILIKE '%' || sqlc.arg(search) || '%')
  AND (COALESCE(due_date, to_timestamp(-62135596800)), id) > (sqlc.arg(cursor_key)::timestamptz, sqlc.arg(cursor_id)::uuid)
ORDER BY COALESCE(due_date, to_timestamp(-62135596800)) ASC, id ASC
LIMIT sqlc.arg(page_limit);

-- name: CountTasks :one
-- Counts the matching tasks up to count_cap rows: counting a very large match set is
-- O(rows) on every first page. A result equal to the cap means "at least that many".
SELECT count(*)
FROM (
    SELECT 1
    FROM tasks.tasks
    WHERE user_id = sqlc.arg(user_id)
      AND (cardinality(sqlc.arg(statuses)::text[]::tasks.status[]) = 0 OR status = ANY (sqlc.arg(statuses)::text[]::tasks.status[]))
      AND (cardinality(sqlc.arg(priorities)::text[]::tasks.priority[]) = 0 OR priority = ANY (sqlc.arg(priorities)::text[]::tasks.priority[]))
      AND (sqlc.arg(search)::text = '' OR title ILIKE '%' || sqlc.arg(search) || '%' OR description ILIKE '%' || sqlc.arg(search) || '%')
    LIMIT sqlc.arg(count_cap)::int
) AS capped;

-- name: GetTaskStats :one
SELECT
    count(*)                                                                                AS total,
    count(*) FILTER (WHERE status = 'todo')                                                 AS todo,
    count(*) FILTER (WHERE status = 'in_progress')                                           AS in_progress,
    count(*) FILTER (WHERE status = 'done')                                                   AS done,
    count(*) FILTER (WHERE status != 'done' AND due_date IS NOT NULL AND due_date < now())    AS overdue
FROM tasks.tasks
WHERE user_id = $1;

-- name: MarkDueSoon :one
-- Guarded "publish once per (task, due date)": a row comes back only the
-- first time, and only while the task is open and still due at that instant;
-- the caller writes the TaskDueSoon outbox row in the same transaction.
INSERT INTO tasks.due_soon_marks (task_id, due_date)
SELECT t.id, t.due_date
FROM tasks.tasks t
WHERE t.id = sqlc.arg(id) AND t.user_id = sqlc.arg(user_id)
  AND t.status <> 'done' AND date_trunc('second', t.due_date) = sqlc.arg(due_date)::timestamptz
ON CONFLICT (task_id, due_date) DO NOTHING
RETURNING task_id;

-- Operator (AdminService) queries: deliberately NOT scoped by user_id. They
-- are reachable only through tasks/api's AdminService, which only the admin
-- module uses, behind the admin role policy.

-- name: AdminListTasks :many
SELECT id, user_id, title, description, status, priority, due_date, completed_at, created_at, updated_at, version
FROM tasks.tasks
WHERE (sqlc.narg(owner_id)::uuid IS NULL OR user_id = sqlc.narg(owner_id)::uuid)
  AND (sqlc.arg(search)::text = '' OR title ILIKE '%' || sqlc.arg(search) || '%')
  AND (created_at, id) < (sqlc.arg(cursor_key)::timestamptz, sqlc.arg(cursor_id)::uuid)
ORDER BY created_at DESC, id DESC
LIMIT sqlc.arg(page_limit);

-- name: AdminDeleteTask :one
DELETE FROM tasks.tasks
WHERE id = $1
RETURNING id, user_id, version;

-- name: AdminTaskStats :one
-- Platform-wide counts over at most row_cap tasks, so the operator dashboard cannot become a
-- full scan of an unbounded table. Above the cap the figures are lower bounds.
SELECT
    count(*)                                                                             AS total,
    count(*) FILTER (WHERE status = 'done')                                              AS done,
    count(*) FILTER (WHERE status != 'done' AND due_date IS NOT NULL AND due_date < now()) AS overdue
FROM (SELECT status, due_date FROM tasks.tasks LIMIT sqlc.arg(row_cap)::int) AS capped;

-- name: CountTasksByOwners :many
SELECT user_id, count(*) AS task_count
FROM tasks.tasks
WHERE user_id = ANY (sqlc.arg(owner_ids)::uuid[])
GROUP BY user_id;
