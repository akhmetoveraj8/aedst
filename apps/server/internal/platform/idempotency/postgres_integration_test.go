//go:build integration

package idempotency_test

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/aedst/server/internal/platform/database"
	"github.com/aedst/server/internal/platform/idempotency"
	"github.com/aedst/server/internal/platform/postgrestest"
	sharederrors "github.com/aedst/server/internal/shared/errors"
)

// The advisory lock taken by Check makes concurrent same-key work run one
// after the other: the callers below each read-then-write a counter guarded
// only by the key, and none may observe another's in-flight state.
func TestPostgresStore_AcquireSerializesSameKey(t *testing.T) {
	pool := postgrestest.NewPool(t)
	ctx := context.Background()
	store := idempotency.NewPostgresStore()

	var (
		mu       sync.Mutex
		inside   int
		overlaps int
		wg       sync.WaitGroup
	)
	for range 8 {
		wg.Go(func() {
			err := database.WithTx(ctx, pool, func(ctx context.Context, tx pgx.Tx) error {
				if err := store.Acquire(ctx, tx, "scope", "key"); err != nil {
					return err
				}
				mu.Lock()
				inside++
				if inside > 1 {
					overlaps++
				}
				mu.Unlock()
				time.Sleep(20 * time.Millisecond)
				mu.Lock()
				inside--
				mu.Unlock()
				return nil
			})
			if err != nil {
				t.Errorf("tx: %v", err)
			}
		})
	}
	wg.Wait()
	if overlaps != 0 {
		t.Fatalf("%d critical sections overlapped for one key", overlaps)
	}
}

func TestPostgresStore_SaveGetAndPurge(t *testing.T) {
	pool := postgrestest.NewPool(t)
	ctx := context.Background()
	store := idempotency.NewPostgresStore()

	err := database.WithTx(ctx, pool, func(ctx context.Context, tx pgx.Tx) error {
		return store.Save(ctx, tx, "s1", "k", "hash", []byte("result"))
	})
	if err != nil {
		t.Fatalf("Save: %v", err)
	}
	err = database.WithTx(ctx, pool, func(ctx context.Context, tx pgx.Tx) error {
		result, hash, found, err := store.Get(ctx, tx, "s1", "k")
		if err != nil || !found || string(result) != "result" || hash != "hash" {
			t.Errorf("Get(s1) = %q, %q, %v, %v", result, hash, found, err)
		}
		if _, _, found, _ := store.Get(ctx, tx, "s2", "k"); found {
			t.Error("Get in another scope found the key")
		}
		return nil
	})
	if err != nil {
		t.Fatalf("Get: %v", err)
	}

	if n, err := idempotency.Purge(ctx, pool, time.Now().Add(-time.Hour), 100); err != nil || n != 0 {
		t.Fatalf("Purge(recent cutoff) = %d, %v; want nothing deleted", n, err)
	}
	if n, err := idempotency.Purge(ctx, pool, time.Now().Add(time.Hour), 100); err != nil || n != 1 {
		t.Fatalf("Purge(future cutoff) = %d, %v; want the one key deleted", n, err)
	}
}

// A caller that waits for a key longer than the statement timeout gets a retryable
// Conflict naming the cause, not an internal error.
func TestPostgresStore_AcquireTimeoutIsAConflict(t *testing.T) {
	pool := postgrestest.NewPool(t)
	ctx := context.Background()
	store := idempotency.NewPostgresStore()

	holder, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = holder.Rollback(ctx) }()
	if err := store.Acquire(ctx, holder, "scope", "busy"); err != nil {
		t.Fatal(err)
	}

	waiter, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = waiter.Rollback(ctx) }()
	if _, err := waiter.Exec(ctx, "SET LOCAL statement_timeout = '300ms'"); err != nil {
		t.Fatal(err)
	}
	err = store.Acquire(ctx, waiter, "scope", "busy")
	if sharederrors.KindOf(err) != sharederrors.KindConflict {
		t.Fatalf("Acquire while the key is held = %v, want a Conflict", err)
	}
}
