//go:build integration

package postgrestest_test

import (
	"context"
	"testing"

	"github.com/aedst/server/internal/platform/postgrestest"
)

// A fresh install carries no trace of the relay era: integration events are
// River jobs (ADR-0014), so there is no outbox or inbox table anywhere, and the
// shared idempotency table is the only platform table.
func TestMigration_FreshInstallHasNoOutboxOrInboxTables(t *testing.T) {
	dsn := postgrestest.NewDatabase(t)
	postgrestest.Migrate(t, dsn, "tasks", "notifications")
	pool := postgrestest.Connect(t, dsn)
	ctx := context.Background()

	count := func(query string, args ...any) (n int) {
		t.Helper()
		if err := pool.QueryRow(ctx, query, args...).Scan(&n); err != nil {
			t.Fatalf("%s: %v", query, err)
		}
		return n
	}
	for _, table := range []string{"tasks.outbox", "tasks.inbox", "tasks.idempotency_keys", "notifications.inbox", "platform.outbox", "platform.inbox"} {
		if got := count(`SELECT count(*) FROM pg_tables WHERE schemaname || '.' || tablename = $1`, table); got != 0 {
			t.Errorf("table %s exists on a fresh install", table)
		}
	}
	if got := count(`SELECT count(*) FROM pg_tables WHERE schemaname = 'platform'`); got != 1 {
		t.Errorf("platform schema holds %d tables, want only idempotency_keys", got)
	}
}
