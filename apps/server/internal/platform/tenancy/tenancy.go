// Package tenancy carries the caller's tenant into PostgreSQL so row-level security can enforce
// isolation in the database itself, not only in WHERE clauses (ADR-0024).
//
// Flow: the OIDC verifier reads the tenant claim (AEDST_OIDC_TENANT_CLAIM) into
// auth.Identity.TenantID; a repository that touches a tenant-scoped table calls Apply as the first
// statement of its transaction; the table's policies compare rows with platform.current_tenant_id()
// and platform.current_user_id(). The settings are transaction-local, so a pooled connection never
// leaks one request's scope into the next, and a transaction that forgets Apply sees no rows.
package tenancy

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	platformdb "github.com/aedst/server/gen/db/platform"
	platformauth "github.com/aedst/server/internal/platform/auth"
)

// ErrNoIdentity is returned by ApplyFromContext when the context carries no authenticated caller.
var ErrNoIdentity = errors.New("tenancy: no authenticated identity in context")

// Scope is what row-level security policies see for the current transaction.
type Scope struct {
	TenantID string // empty in a single-tenant deployment
	UserID   string
}

// ScopeOf builds the scope of an authenticated caller.
func ScopeOf(id platformauth.Identity) Scope {
	return Scope{TenantID: id.TenantID, UserID: id.UserID.String()}
}

// Apply sets the scope for the rest of tx. Call it before the first query on a tenant-scoped table.
func Apply(ctx context.Context, tx pgx.Tx, s Scope) error {
	if err := platformdb.New(tx).SetRequestScope(ctx, platformdb.SetRequestScopeParams{TenantID: s.TenantID, UserID: s.UserID}); err != nil {
		return fmt.Errorf("tenancy: set request scope: %w", err)
	}
	return nil
}

// ApplyFromContext applies the scope of the caller in ctx (set by httpserver.AuthInterceptor).
// Background jobs have no caller: they build a Scope from the job's own data and call Apply.
func ApplyFromContext(ctx context.Context, tx pgx.Tx) error {
	id, ok := platformauth.FromContext(ctx)
	if !ok {
		return ErrNoIdentity
	}
	return Apply(ctx, tx, ScopeOf(id))
}
