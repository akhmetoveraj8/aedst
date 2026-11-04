-- name: ClaimToken :execrows
-- Atomically records a verified token. 0 rows = the token was already used
-- (replay): the PRIMARY KEY is the single source of truth, not a cache.
INSERT INTO integrity.verified_tokens (token_hash, user_id, verified_at)
VALUES ($1, $2, $3)
ON CONFLICT (token_hash) DO NOTHING;

-- name: PurgeVerifiedTokens :execrows
DELETE FROM integrity.verified_tokens
WHERE token_hash IN (
    SELECT t.token_hash FROM integrity.verified_tokens t
    WHERE t.verified_at < sqlc.arg(cutoff)::timestamptz
    LIMIT sqlc.arg(row_limit)::int
);
