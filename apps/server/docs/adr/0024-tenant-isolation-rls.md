# ADR-0024: Tenant isolation: tenant claim, transaction scope and row-level security

- Status: Accepted (2026-11-25). Adds to [ADR-0017](0017-identity-provider.md) and
  [ADR-0019](0019-remove-first-party-auth.md); changes no existing table.
- Scope: `apps/server`.

## Context

Every table today is per user: rows carry `user_id` and every sqlc query filters by it
(`FindTaskByIDAndUserID`). That isolates people, but a B2B product needs data owned by an
organisation (projects, invoices, members' shared lists), and a WHERE clause forgotten once is a
cross-tenant data leak. Retrofitting tenants after launch means touching every query.

## Decision

Tenant isolation is enforced in three layers, the last one inside PostgreSQL:

1. **Identity.** The tenant is a claim of the access token, read by the OIDC verifier:
   `AEDST_OIDC_TENANT_CLAIM` (ZITADEL: `urn:zitadel:iam:user:resourceowner:id`, the user's
   organisation). It becomes `auth.Identity.TenantID`. `AEDST_OIDC_TENANT_REQUIRED=true` rejects a
   token without it (`auth.ErrMissingTenant`). Empty claim name = single tenant, today's behaviour.
2. **Transaction scope.** A repository that touches a tenant-scoped table calls
   `tenancy.ApplyFromContext(ctx, tx)` (or `tenancy.Apply` with a scope built from a job's data) as
   the first statement of its transaction. It runs the sqlc query `SetRequestScope`:
   `set_config('app.tenant_id' | 'app.user_id', value, true)`. The settings are transaction-local,
   so a pooled connection (PgBouncer in transaction mode included) never carries a scope into the
   next request.
3. **Row-level security.** A tenant-scoped table has a `tenant_id text NOT NULL` column,
   `ENABLE` and `FORCE ROW LEVEL SECURITY`, and a policy
   `USING (tenant_id = platform.current_tenant_id()) WITH CHECK (tenant_id = platform.current_tenant_id())`.
   The helper functions (migration `platform/00002`) return NULL when no scope is set, so a
   transaction that forgot step 2 sees no rows instead of all rows (fail closed).

The application must connect as a role that is **not** a superuser and does not have `BYPASSRLS`;
superusers bypass every policy. Migrations run as the owner role; River workers that legitimately
cross tenants (retention purges) use a separate role with `BYPASSRLS`, granted only to the jobs pool.

## Recipe for a new tenant-scoped table

```sql
CREATE TABLE billing.invoices (
    id         uuid PRIMARY KEY,
    tenant_id  text NOT NULL,
    ...
);
CREATE INDEX idx_invoices_tenant ON billing.invoices (tenant_id, id);
ALTER TABLE billing.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing.invoices FORCE ROW LEVEL SECURITY;
CREATE POLICY invoices_tenant ON billing.invoices
    USING (tenant_id = platform.current_tenant_id())
    WITH CHECK (tenant_id = platform.current_tenant_id());
```

Queries still filter by `tenant_id` explicitly (the index needs it and the intent stays readable);
RLS is the safety net when a query forgets. The proof is
`internal/platform/tenancy/tenancy_integration_test.go`: two tenants see only their own rows, a
transaction without a scope sees none, a cross-tenant insert is refused, and the scope does not leak
into the next transaction.

## Consequences

- Existing per-user tables (`tasks`, `notifications`, `media`) are unchanged: they are owned by a
  person, and `user_id` already isolates them. They move to a tenant when a product makes them
  organisation-owned, following the recipe above in a new migration.
- One extra `SELECT set_config(...)` per transaction on tenant-scoped paths (sub-millisecond, same
  round trip budget as `SET LOCAL`).
- Operations need two database roles (application, owner) plus an optional `BYPASSRLS` jobs role.

## Revisit when

- A product needs a user in several tenants at once (switching organisations): the tenant then
  comes from a request header validated against the token's grants, not from one claim.
- A tenant outgrows a shared database: schema- or database-per-tenant routing (ADR-0020 topology).
