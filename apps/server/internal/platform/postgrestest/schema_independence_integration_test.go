//go:build integration

package postgrestest_test

import (
	"context"
	"testing"

	"github.com/aedst/server/internal/platform/postgrestest"
)

// Database-per-module (docs/content/server/runbook-postgres-scaling.md, step 4)
// is only a dump/restore exercise while no module's schema depends on another's
// at the database level. This test is that precondition: after every migration,
// no foreign key and no view reaches across a module schema. (River's tables and
// platform.idempotency_keys are shared infrastructure, not module schemas; the
// runbook covers them.)
func TestSchemas_NoForeignKeysOrViewsCrossModuleSchemas(t *testing.T) {
	pool := postgrestest.NewPool(t, "auth", "tasks", "notifications", "search", "media", "admin", "integrity", "appattest")
	ctx := context.Background()

	rows, err := pool.Query(ctx, `
		SELECT 'foreign key', c.conname, src.nspname, dst.nspname
		FROM pg_constraint c
		JOIN pg_class sc ON sc.oid = c.conrelid   JOIN pg_namespace src ON src.oid = sc.relnamespace
		JOIN pg_class dc ON dc.oid = c.confrelid  JOIN pg_namespace dst ON dst.oid = dc.relnamespace
		WHERE c.contype = 'f' AND src.nspname <> dst.nspname
		UNION ALL
		SELECT 'view', v.relname, vn.nspname, dn.nspname
		FROM pg_rewrite r
		JOIN pg_class v ON v.oid = r.ev_class         JOIN pg_namespace vn ON vn.oid = v.relnamespace
		JOIN pg_depend d ON d.objid = r.oid AND d.classid = 'pg_rewrite'::regclass AND d.refclassid = 'pg_class'::regclass
		JOIN pg_class t ON t.oid = d.refobjid AND t.oid <> v.oid
		JOIN pg_namespace dn ON dn.oid = t.relnamespace
		WHERE vn.nspname NOT IN ('pg_catalog', 'information_schema') AND vn.nspname <> dn.nspname
		  AND dn.nspname NOT IN ('pg_catalog', 'information_schema')`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	for rows.Next() {
		var kind, name, from, to string
		if err := rows.Scan(&kind, &name, &from, &to); err != nil {
			t.Fatal(err)
		}
		t.Errorf("%s %q in schema %s depends on schema %s: a module may not depend on another module's schema at the database level", kind, name, from, to)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
}
