//go:build integration

package tenancy_test

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/aedst/server/internal/platform/postgrestest"
	"github.com/aedst/server/internal/platform/tenancy"
)

// The ADR-0024 recipe end to end: a tenant-scoped table with FORCE ROW LEVEL SECURITY, read by a
// non-superuser role (superusers bypass RLS), sees only the rows of the tenant set by Apply, and
// nothing at all when Apply was not called.
func TestApply_RowLevelSecurityIsolatesTenants(t *testing.T) {
	pool := postgrestest.NewPool(t)
	ctx := context.Background()
	for _, stmt := range []string{
		`DO $$ BEGIN CREATE ROLE tenancy_app NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
		`GRANT USAGE ON SCHEMA platform TO tenancy_app`,
		`CREATE TABLE public.projects (id int PRIMARY KEY, tenant_id text NOT NULL, name text NOT NULL)`,
		`ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY`,
		`ALTER TABLE public.projects FORCE ROW LEVEL SECURITY`,
		`CREATE POLICY projects_tenant ON public.projects
		     USING (tenant_id = platform.current_tenant_id())
		     WITH CHECK (tenant_id = platform.current_tenant_id())`,
		`GRANT SELECT, INSERT ON public.projects TO tenancy_app`,
		`INSERT INTO public.projects VALUES (1, 'org-a', 'alpha'), (2, 'org-b', 'beta')`,
	} {
		if _, err := pool.Exec(ctx, stmt); err != nil {
			t.Fatalf("%s: %v", stmt, err)
		}
	}

	visible := func(scope *tenancy.Scope) []string {
		t.Helper()
		var names []string
		err := pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
			if _, err := tx.Exec(ctx, `SET LOCAL ROLE tenancy_app`); err != nil {
				return err
			}
			if scope != nil {
				if err := tenancy.Apply(ctx, tx, *scope); err != nil {
					return err
				}
			}
			rows, err := tx.Query(ctx, `SELECT name FROM public.projects ORDER BY id`)
			if err != nil {
				return err
			}
			names, err = pgx.CollectRows(rows, pgx.RowTo[string])
			return err
		})
		if err != nil {
			t.Fatal(err)
		}
		return names
	}

	if got := visible(&tenancy.Scope{TenantID: "org-a", UserID: "u1"}); len(got) != 1 || got[0] != "alpha" {
		t.Fatalf("org-a sees %v, want [alpha]", got)
	}
	if got := visible(&tenancy.Scope{TenantID: "org-b", UserID: "u2"}); len(got) != 1 || got[0] != "beta" {
		t.Fatalf("org-b sees %v, want [beta]", got)
	}
	if got := visible(nil); len(got) != 0 {
		t.Fatalf("a transaction without a scope sees %v, want nothing (fail closed)", got)
	}

	// WITH CHECK: a tenant cannot write a row into another tenant.
	err := pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `SET LOCAL ROLE tenancy_app`); err != nil {
			return err
		}
		if err := tenancy.Apply(ctx, tx, tenancy.Scope{TenantID: "org-a", UserID: "u1"}); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `INSERT INTO public.projects VALUES (3, 'org-b', 'intrusion')`)
		return err
	})
	if err == nil {
		t.Fatal("a cross-tenant insert was accepted")
	}

	// The scope is transaction-local: the next transaction on the same pool starts empty.
	if got := visible(nil); len(got) != 0 {
		t.Fatalf("scope leaked into a later transaction: %v", got)
	}
}
