-- +goose Up

-- Tenant isolation helpers (ADR-0024). internal/platform/tenancy sets app.tenant_id and
-- app.user_id with set_config(..., true) at the start of a request's transaction; row-level
-- security policies compare rows against these functions. Both return NULL when the setting is
-- absent or empty, and a comparison with NULL is never true, so a transaction that forgot to set
-- its scope sees no rows of a tenant-scoped table (fail closed).

-- +goose StatementBegin
CREATE FUNCTION platform.current_tenant_id() RETURNS text
    LANGUAGE sql STABLE PARALLEL SAFE
    AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '') $$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE FUNCTION platform.current_user_id() RETURNS text
    LANGUAGE sql STABLE PARALLEL SAFE
    AS $$ SELECT NULLIF(current_setting('app.user_id', true), '') $$;
-- +goose StatementEnd

-- +goose Down
DROP FUNCTION platform.current_user_id();
DROP FUNCTION platform.current_tenant_id();
