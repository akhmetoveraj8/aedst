package idempotency_test

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/aedst/server/internal/platform/idempotency"
)

// benchPayload is the size of a typical queued write (a CreateTask request).
var benchPayload = []byte(`{"title":"Write the quarterly report","description":"Collect the numbers from finance and sales, then draft the summary.","priority":"high","due_date":"2026-12-01T09:00:00Z"}`)

func BenchmarkHashRequest(b *testing.B) {
	b.ReportAllocs()
	for b.Loop() {
		if idempotency.HashRequest(benchPayload) == "" {
			b.Fatal("empty hash")
		}
	}
}

// replayStore answers every lookup with a stored result for benchPayload.
type replayStore struct{ hash string }

func (replayStore) Acquire(context.Context, pgx.Tx, string, string) error { return nil }

func (s replayStore) Get(context.Context, pgx.Tx, string, string) ([]byte, string, bool, error) {
	return benchPayload, s.hash, true, nil
}

func (replayStore) Save(context.Context, pgx.Tx, string, string, string, []byte) error { return nil }

// BenchmarkCheckReplay is the per-request overhead of an idempotent write
// besides its two SQL statements: hashing and comparing the request.
func BenchmarkCheckReplay(b *testing.B) {
	store := replayStore{hash: idempotency.HashRequest(benchPayload)}
	ctx := context.Background()
	b.ReportAllocs()
	for b.Loop() {
		if _, replay, err := idempotency.Check(ctx, nil, store, "tasks:user", "key-1", benchPayload); err != nil || !replay {
			b.Fatalf("Check = replay %v, %v", replay, err)
		}
	}
}
