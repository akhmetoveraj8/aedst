-- +goose no transaction
-- +goose Up

-- Operator user directory (AdminService.ListUsers through auth/api.Directory):
-- keyset on (created_at, user_id) newest first, and substring search on email.
-- A failed CONCURRENTLY build leaves an INVALID index that IF NOT EXISTS would keep; drop it so a retry rebuilds.
DROP INDEX CONCURRENTLY IF EXISTS auth.idx_auth_credentials_created_keyset;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_auth_credentials_created_keyset
    ON auth.credentials (created_at, user_id);

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- A failed CONCURRENTLY build leaves an INVALID index that IF NOT EXISTS would keep; drop it so a retry rebuilds.
DROP INDEX CONCURRENTLY IF EXISTS auth.idx_auth_credentials_email_trgm;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_auth_credentials_email_trgm
    ON auth.credentials USING gin (email gin_trgm_ops);

-- +goose Down
DROP INDEX CONCURRENTLY IF EXISTS auth.idx_auth_credentials_email_trgm;
DROP INDEX CONCURRENTLY IF EXISTS auth.idx_auth_credentials_created_keyset;
