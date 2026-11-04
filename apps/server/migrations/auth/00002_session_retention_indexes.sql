-- +goose no transaction
-- +goose Up

-- Back the retention purge of dead sessions (internal/platform/retention):
-- without them the periodic DELETE scans the whole table. Partial on
-- revoked_at because most sessions are never revoked.
-- A failed CONCURRENTLY build leaves an INVALID index that IF NOT EXISTS would keep; drop it so a retry rebuilds.
DROP INDEX CONCURRENTLY IF EXISTS auth.idx_auth_sessions_expires_at;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_auth_sessions_expires_at
    ON auth.sessions (expires_at);
-- A failed CONCURRENTLY build leaves an INVALID index that IF NOT EXISTS would keep; drop it so a retry rebuilds.
DROP INDEX CONCURRENTLY IF EXISTS auth.idx_auth_sessions_revoked_at;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_auth_sessions_revoked_at
    ON auth.sessions (revoked_at)
    WHERE revoked_at IS NOT NULL;

-- +goose Down
DROP INDEX CONCURRENTLY IF EXISTS auth.idx_auth_sessions_revoked_at;
DROP INDEX CONCURRENTLY IF EXISTS auth.idx_auth_sessions_expires_at;
