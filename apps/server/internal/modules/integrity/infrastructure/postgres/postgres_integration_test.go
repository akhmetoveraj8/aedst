//go:build integration

package postgres_test

import (
	"context"
	"crypto/sha256"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/aedst/server/internal/modules/integrity/infrastructure/postgres"
	"github.com/aedst/server/internal/platform/postgrestest"
	"github.com/aedst/server/internal/shared/ids"
)

func TestClaim_FirstWinsEvenUnderRace(t *testing.T) {
	repo := postgres.NewRepository(postgrestest.NewPool(t, "integrity"))
	ctx := context.Background()
	hash := sha256.Sum256([]byte("token-a"))
	at := time.Now().UTC()

	var wins atomic.Int32
	var wg sync.WaitGroup
	for range 8 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			first, err := repo.Claim(ctx, hash, ids.New(), at)
			if err != nil {
				t.Errorf("Claim: %v", err)
			}
			if first {
				wins.Add(1)
			}
		}()
	}
	wg.Wait()
	if wins.Load() != 1 {
		t.Fatalf("%d concurrent claims won, want exactly 1", wins.Load())
	}
	if first, err := repo.Claim(ctx, sha256.Sum256([]byte("token-b")), ids.New(), at); err != nil || !first {
		t.Fatalf("a different token must be claimable: %v %v", first, err)
	}
}

func TestPurgeOlderThan_DeletesOnlyOldRowsAndFreesTheToken(t *testing.T) {
	repo := postgres.NewRepository(postgrestest.NewPool(t, "integrity"))
	ctx := context.Background()
	now := time.Now().UTC()
	old, fresh := sha256.Sum256([]byte("old")), sha256.Sum256([]byte("fresh"))
	if _, err := repo.Claim(ctx, old, ids.New(), now.Add(-2*time.Hour)); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.Claim(ctx, fresh, ids.New(), now); err != nil {
		t.Fatal(err)
	}
	n, err := repo.PurgeOlderThan(ctx, now.Add(-time.Hour), 100)
	if err != nil || n != 1 {
		t.Fatalf("purged %d, %v; want 1", n, err)
	}
	if first, _ := repo.Claim(ctx, fresh, ids.New(), now); first {
		t.Error("fresh row must survive the purge")
	}
	if first, _ := repo.Claim(ctx, old, ids.New(), now); !first {
		t.Error("purged row's token is claimable again")
	}
}
