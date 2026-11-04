-- name: CreateChallenge :exec
INSERT INTO appattest.challenges (id, user_id, challenge, expires_at)
VALUES ($1, $2, $3, $4);

-- name: ConsumeChallenge :execrows
-- Atomically spends a challenge: it must belong to the caller, be unspent and
-- unexpired. 0 rows = unknown, expired, already used or someone else's. The
-- single UPDATE is the source of truth for "usable once", not a cache.
UPDATE appattest.challenges
SET consumed_at = sqlc.arg(now)::timestamptz
WHERE user_id = sqlc.arg(user_id)
  AND challenge = sqlc.arg(challenge)
  AND consumed_at IS NULL
  AND expires_at > sqlc.arg(now)::timestamptz;

-- name: PurgeChallenges :execrows
DELETE FROM appattest.challenges
WHERE id IN (
    SELECT c.id FROM appattest.challenges c
    WHERE c.expires_at < sqlc.arg(cutoff)::timestamptz
    LIMIT sqlc.arg(row_limit)::int
);

-- name: InsertKey :execrows
-- 0 rows = the key id is already enrolled (by anyone).
INSERT INTO appattest.keys (key_id, user_id, bundle_id, public_key, counter, environment, created_at, last_used_at)
VALUES ($1, $2, $3, $4, 0, $5, $6, $6)
ON CONFLICT (key_id) DO NOTHING;

-- name: GetKey :one
-- A key is only visible to the user it was enrolled for, and not once revoked.
SELECT key_id, user_id, bundle_id, public_key, counter, environment, created_at, last_used_at
FROM appattest.keys
WHERE key_id = $1 AND user_id = $2 AND revoked_at IS NULL;

-- name: AdvanceCounter :execrows
-- Compare-and-set: the counter only moves forward. 0 rows = the new counter is
-- not greater than the stored one (a replayed assertion) or the key is gone.
UPDATE appattest.keys
SET counter = sqlc.arg(new_counter)::bigint, last_used_at = sqlc.arg(now)::timestamptz
WHERE key_id = sqlc.arg(key_id)
  AND user_id = sqlc.arg(user_id)
  AND revoked_at IS NULL
  AND counter < sqlc.arg(new_counter)::bigint;

-- name: PurgeKeys :execrows
DELETE FROM appattest.keys
WHERE key_id IN (
    SELECT k.key_id FROM appattest.keys k
    WHERE k.last_used_at < sqlc.arg(cutoff)::timestamptz
    LIMIT sqlc.arg(row_limit)::int
);
