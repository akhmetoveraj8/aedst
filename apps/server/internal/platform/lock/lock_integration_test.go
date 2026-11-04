//go:build integration

package lock_test

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/aedst/server/internal/platform/database"
	"github.com/aedst/server/internal/platform/lock"
	"github.com/aedst/server/internal/platform/postgrestest"
)

func TestLocker_SessionLockIsExclusiveAndReleasable(t *testing.T) {
	pool := postgrestest.NewPool(t)
	locker := lock.NewLocker(&database.DirectPool{Pool: pool}) // postgrestest connects to Postgres directly
	ctx := context.Background()

	release, ok, err := locker.TryLock(ctx, "test:exclusive")
	if err != nil || !ok {
		t.Fatalf("first TryLock() = ok %v, err %v; want acquired", ok, err)
	}

	if _, ok, err := locker.TryLock(ctx, "test:exclusive"); err != nil || ok {
		t.Fatalf("second TryLock() = ok %v, err %v; want not acquired", ok, err)
	}
	releaseOther, ok, err := locker.TryLock(ctx, "test:other")
	if err != nil || !ok {
		t.Fatalf("TryLock() on a different name = ok %v, err %v; want acquired", ok, err)
	}

	releaseOther() // an unreleased lease keeps its connection checked out and hangs pool.Close
	release()
	release2, ok, err := locker.TryLock(ctx, "test:exclusive")
	if err != nil || !ok {
		t.Fatalf("TryLock() after release = ok %v, err %v; want acquired", ok, err)
	}
	release2()
}

func TestLocker_WithTryLockReportsContention(t *testing.T) {
	pool := postgrestest.NewPool(t)
	locker := lock.NewLocker(&database.DirectPool{Pool: pool}) // postgrestest connects to Postgres directly
	ctx := context.Background()

	err := locker.WithTryLock(ctx, "test:with", func(ctx context.Context) error {
		return locker.WithTryLock(ctx, "test:with", func(context.Context) error { return nil })
	})
	if !errors.Is(err, lock.ErrNotAcquired) {
		t.Fatalf("nested WithTryLock() err = %v, want ErrNotAcquired", err)
	}
}

func TestTryXact_ReleasedAtTransactionEnd(t *testing.T) {
	pool := postgrestest.NewPool(t)
	ctx := context.Background()

	err := database.WithTx(ctx, pool, func(ctx context.Context, tx pgx.Tx) error {
		if ok, err := lock.TryXact(ctx, tx, "test:xact"); err != nil || !ok {
			t.Fatalf("TryXact() in tx 1 = %v, %v; want acquired", ok, err)
		}
		// A second transaction cannot take it while tx 1 is open.
		return database.WithTx(ctx, pool, func(ctx context.Context, tx2 pgx.Tx) error {
			if ok, err := lock.TryXact(ctx, tx2, "test:xact"); err != nil || ok {
				t.Fatalf("TryXact() in tx 2 = %v, %v; want contended", ok, err)
			}
			return nil
		})
	})
	if err != nil {
		t.Fatal(err)
	}

	err = database.WithTx(ctx, pool, func(ctx context.Context, tx pgx.Tx) error {
		if ok, err := lock.TryXact(ctx, tx, "test:xact"); err != nil || !ok {
			t.Fatalf("TryXact() after tx 1 ended = %v, %v; want acquired", ok, err)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}
