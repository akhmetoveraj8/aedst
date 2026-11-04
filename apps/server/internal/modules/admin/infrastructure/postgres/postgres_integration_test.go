//go:build integration

package postgres_test

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/aedst/server/internal/modules/admin/domain"
	"github.com/aedst/server/internal/modules/admin/infrastructure/postgres"
	platformjobs "github.com/aedst/server/internal/platform/jobs"
	"github.com/aedst/server/internal/platform/postgrestest"
	"github.com/aedst/server/internal/shared/ids"
	sharedtime "github.com/aedst/server/internal/shared/time"
)

func TestAuditLog_AtomicWithTheActionAndPaged(t *testing.T) {
	pool := postgrestest.NewPool(t, "admin")
	repo := postgres.NewRepository(pool, platformjobs.NewPoolStats(pool), sharedtime.Real{})
	ctx := context.Background()
	old := time.Now().AddDate(0, 0, -40) // beyond the 30-day append-only floor, so retention may delete these
	actor := domain.Actor{UserID: ids.New(), Subject: "op@example.com", Issuer: "https://idp"}

	for i := range 3 {
		err := repo.Run(ctx, func(ctx context.Context, tx pgx.Tx) error {
			return repo.InsertTx(ctx, tx, domain.AuditEntry{
				ID: ids.New(), Actor: actor, Action: domain.ActionDeleteTask, TargetKind: domain.TargetTask,
				TargetID: ids.New().String(), Reason: "cleanup", Metadata: map[string]any{"i": i},
				CreatedAt: old.Add(time.Duration(i) * time.Millisecond),
			})
		})
		if err != nil {
			t.Fatal(err)
		}
	}
	// The mutation fails after the entry was written: the entry rolls back with it.
	boom := errors.New("mutation failed")
	err := repo.Run(ctx, func(ctx context.Context, tx pgx.Tx) error {
		if err := repo.InsertTx(ctx, tx, domain.AuditEntry{ID: ids.New(), Actor: actor, Action: "x", TargetKind: "y", CreatedAt: time.Now()}); err != nil {
			return err
		}
		return boom
	})
	if !errors.Is(err, boom) {
		t.Fatalf("Run = %v", err)
	}

	first, next, err := repo.List(ctx, 2, nil)
	if err != nil || len(first) != 2 || next == nil || first[0].Metadata["i"] != float64(2) || first[0].Actor != actor {
		t.Fatalf("first page = %+v, %v, %v", first, next, err)
	}
	rest, next, err := repo.List(ctx, 2, next)
	if err != nil || len(rest) != 1 || next != nil {
		t.Fatalf("second page = %+v, %v", rest, err)
	}

	if lag, err := repo.JobLag(ctx); err != nil || lag != 0 {
		t.Errorf("JobLag = %v, %v", lag, err)
	}
	if n, err := repo.PendingJobs(ctx); err != nil || n != 0 {
		t.Errorf("PendingJobs = %d, %v", n, err)
	}
	if n, err := repo.Purge(ctx, time.Now().Add(time.Hour), 100); err != nil || n != 3 {
		t.Errorf("Purge = %d, %v", n, err)
	}
}

// The audit trail is append-only in the database itself: no update, no truncate, and
// nothing younger than the 30-day floor can be deleted, whatever the application does.
func TestAuditLog_IsAppendOnly(t *testing.T) {
	pool := postgrestest.NewPool(t, "admin")
	ctx := context.Background()
	repo := postgres.NewRepository(pool, platformjobs.NewPoolStats(pool), sharedtime.Real{})
	actor := domain.Actor{UserID: ids.New(), Subject: "op@example.com", Issuer: "https://idp"}
	id := ids.New()
	if err := repo.Run(ctx, func(ctx context.Context, tx pgx.Tx) error {
		return repo.InsertTx(ctx, tx, domain.AuditEntry{ID: id, Actor: actor, Action: "x", TargetKind: "y", CreatedAt: time.Now()})
	}); err != nil {
		t.Fatal(err)
	}
	for name, stmt := range map[string]string{
		"update":   "UPDATE admin.audit_log SET reason = 'edited'",
		"delete":   "DELETE FROM admin.audit_log",
		"truncate": "TRUNCATE admin.audit_log",
	} {
		if _, err := pool.Exec(ctx, stmt); err == nil {
			t.Errorf("%s of a fresh audit row succeeded", name)
		} else if !strings.Contains(err.Error(), "append-only") {
			t.Errorf("%s: %v, want the append-only guard", name, err)
		}
	}
	if n, err := repo.Purge(ctx, time.Now().Add(time.Hour), 100); err == nil {
		t.Errorf("retention deleted %d fresh rows; the 30-day floor must hold", n)
	}
}
