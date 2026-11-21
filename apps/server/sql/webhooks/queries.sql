-- Endpoint queries never return secret_ciphertext, except GetEndpointSecret
-- (the delivery worker and the idempotent replay of CreateEndpoint).

-- name: CreateEndpoint :one
INSERT INTO webhooks.endpoints (id, url, description, event_types, secret_ciphertext, status, created_at, updated_at)
VALUES (sqlc.arg(id), sqlc.arg(url), sqlc.arg(description), sqlc.arg(event_types), sqlc.arg(secret_ciphertext), 'active', sqlc.arg(created_at), sqlc.arg(created_at))
RETURNING id, url, description, event_types, status, consecutive_failures, disabled_reason, created_at, updated_at;

-- name: GetEndpoint :one
SELECT id, url, description, event_types, status, consecutive_failures, disabled_reason, created_at, updated_at
FROM webhooks.endpoints
WHERE id = sqlc.arg(id);

-- name: GetEndpointSecret :one
SELECT id, url, status, secret_ciphertext
FROM webhooks.endpoints
WHERE id = sqlc.arg(id);

-- Keyset page of endpoints, newest first; fetch page_limit+1 (see
-- internal/shared/pagination). The first page passes an open cursor.
-- name: ListEndpoints :many
SELECT id, url, description, event_types, status, consecutive_failures, disabled_reason, created_at, updated_at
FROM webhooks.endpoints
WHERE (created_at, id) < (sqlc.arg(cursor_key)::timestamptz, sqlc.arg(cursor_id)::uuid)
ORDER BY created_at DESC, id DESC
LIMIT sqlc.arg(page_limit);

-- name: RotateEndpointSecret :one
UPDATE webhooks.endpoints
SET secret_ciphertext = sqlc.arg(secret_ciphertext), updated_at = sqlc.arg(updated_at)
WHERE id = sqlc.arg(id)
RETURNING id, url, description, event_types, status, consecutive_failures, disabled_reason, created_at, updated_at;

-- Guarded transition: no row means the endpoint is missing or already disabled.
-- name: DisableEndpoint :one
UPDATE webhooks.endpoints
SET status = 'disabled', disabled_reason = sqlc.arg(disabled_reason), updated_at = sqlc.arg(updated_at)
WHERE id = sqlc.arg(id) AND status = 'active'
RETURNING id, url, description, event_types, status, consecutive_failures, disabled_reason, created_at, updated_at;

-- Guarded transition: no row means the endpoint is missing or already active.
-- name: EnableEndpoint :one
UPDATE webhooks.endpoints
SET status = 'active', disabled_reason = '', consecutive_failures = 0, updated_at = sqlc.arg(updated_at)
WHERE id = sqlc.arg(id) AND status = 'disabled'
RETURNING id, url, description, event_types, status, consecutive_failures, disabled_reason, created_at, updated_at;

-- name: DeleteEndpoint :execrows
DELETE FROM webhooks.endpoints
WHERE id = sqlc.arg(id);

-- Active endpoints subscribed to one event type (the fan-out). Endpoints are
-- operator-managed; max_endpoints bounds the read all the same.
-- name: ListSubscribedEndpointIDs :many
SELECT id
FROM webhooks.endpoints
WHERE status = 'active' AND event_types @> ARRAY[sqlc.arg(event_type)::text]
ORDER BY id
LIMIT sqlc.arg(max_endpoints);

-- One delivery row per endpoint in one statement. An endpoint that was disabled
-- or deleted since it was read is skipped by the join; a delivery that already
-- exists for (endpoint, event) is skipped by ON CONFLICT, and only the rows
-- actually inserted are returned, so a redelivered event enqueues nothing twice.
-- name: InsertDeliveries :many
INSERT INTO webhooks.deliveries (id, endpoint_id, event_id, event_type, payload, status, created_at, updated_at)
SELECT u.id, e.id, sqlc.arg(event_id), sqlc.arg(event_type), sqlc.arg(payload), 'pending', sqlc.arg(created_at), sqlc.arg(created_at)
FROM (
    -- Two arrays of one length unnest in step (sqlc does not parse the
    -- multi-argument form of unnest).
    SELECT unnest(sqlc.arg(ids)::uuid[]) AS id, unnest(sqlc.arg(endpoint_ids)::uuid[]) AS endpoint_id
) u
JOIN webhooks.endpoints e ON e.id = u.endpoint_id AND e.status = 'active'
ON CONFLICT (endpoint_id, event_id) DO NOTHING
RETURNING endpoint_id;

-- Keyset page of one endpoint's deliveries, newest first; fetch page_limit+1.
-- name: ListDeliveries :many
SELECT id, endpoint_id, event_id, event_type, status, attempts, last_status_code, last_error, created_at, updated_at, delivered_at
FROM webhooks.deliveries
WHERE endpoint_id = sqlc.arg(endpoint_id)
  AND (created_at, id) < (sqlc.arg(cursor_key)::timestamptz, sqlc.arg(cursor_id)::uuid)
ORDER BY created_at DESC, id DESC
LIMIT sqlc.arg(page_limit);

-- name: GetDelivery :one
SELECT id, endpoint_id, event_id, event_type, status, attempts, last_status_code, last_error, created_at, updated_at, delivered_at
FROM webhooks.deliveries
WHERE id = sqlc.arg(id);

-- Guarded transition for RedeliverDelivery: only a failed or cancelled delivery
-- of an active endpoint goes back to pending. No row means one of those does
-- not hold; the caller reads the delivery to say which.
-- name: RequeueDelivery :one
UPDATE webhooks.deliveries d
SET status = 'pending', updated_at = sqlc.arg(updated_at)
FROM webhooks.endpoints e
WHERE d.id = sqlc.arg(id)
  AND e.id = d.endpoint_id
  AND e.status = 'active'
  AND d.status IN ('failed', 'cancelled')
RETURNING d.endpoint_id, d.event_id, d.event_type, d.payload;

-- The outcome of one attempt, written by the delivery worker.
-- name: RecordDeliveryAttempt :execrows
UPDATE webhooks.deliveries
SET status = sqlc.arg(status),
    attempts = attempts + sqlc.arg(attempts_delta),
    last_status_code = sqlc.arg(last_status_code),
    last_error = sqlc.arg(last_error),
    delivered_at = CASE WHEN sqlc.arg(status)::text = 'delivered' THEN sqlc.arg(updated_at)::timestamptz ELSE delivered_at END,
    updated_at = sqlc.arg(updated_at)
WHERE endpoint_id = sqlc.arg(endpoint_id) AND event_id = sqlc.arg(event_id);

-- name: ResetEndpointFailures :exec
UPDATE webhooks.endpoints
SET consecutive_failures = 0
WHERE id = sqlc.arg(id) AND consecutive_failures <> 0;

-- Counts one failed delivery and, in the same statement, disables the endpoint
-- when the counter reaches the threshold (the dead-letter state).
-- name: RecordEndpointFailure :exec
UPDATE webhooks.endpoints
SET consecutive_failures = consecutive_failures + 1,
    status = CASE WHEN consecutive_failures + 1 >= sqlc.arg(threshold)::int THEN 'disabled' ELSE status END,
    disabled_reason = CASE WHEN consecutive_failures + 1 >= sqlc.arg(threshold)::int THEN 'consecutive_failures' ELSE disabled_reason END,
    updated_at = sqlc.arg(updated_at)
WHERE id = sqlc.arg(id) AND status = 'active';

-- Retention: deletes up to batch_limit deliveries created before the cutoff.
-- name: PurgeDeliveries :execrows
DELETE FROM webhooks.deliveries
WHERE id IN (
    SELECT id FROM webhooks.deliveries d
    WHERE d.created_at < sqlc.arg(cutoff)
    ORDER BY d.created_at
    LIMIT sqlc.arg(batch_limit)
);
