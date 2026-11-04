-- name: GetIdempotencyKey :one
SELECT result, request_hash
FROM platform.idempotency_keys
WHERE scope = $1 AND key = $2;

-- name: SaveIdempotencyKey :exec
-- Acquire serialized concurrent writers, so a conflict here can only mean a
-- caller skipped Check; keep the first result then.
INSERT INTO platform.idempotency_keys (scope, key, request_hash, result)
VALUES ($1, $2, $3, $4)
ON CONFLICT (scope, key) DO NOTHING;

-- name: PurgeIdempotencyKeys :execrows
-- Deletes at most max_rows keys created before cutoff.
DELETE FROM platform.idempotency_keys
WHERE (scope, key) IN (
    SELECT i.scope, i.key FROM platform.idempotency_keys i WHERE i.created_at < sqlc.arg(cutoff) LIMIT sqlc.arg(max_rows)
);

-- name: CountPendingJobs :one
SELECT count(*)::bigint
FROM river_job
WHERE state IN ('available', 'retryable', 'scheduled');

-- name: OldestAvailableJobAt :one
-- Scheduled time of the oldest job that is ready to run at sqlc.arg(now); NULL when none.
SELECT min(scheduled_at)::timestamptz
FROM river_job
WHERE state = 'available' AND scheduled_at <= sqlc.arg(now);

-- name: CountJobsByState :many
SELECT state::text AS state, count(*)::bigint AS jobs
FROM river_job
WHERE state = ANY(sqlc.arg(states)::text[]::river_job_state[])
GROUP BY state;
