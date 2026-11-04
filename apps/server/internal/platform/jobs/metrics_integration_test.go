//go:build integration

package jobs_test

import (
	"context"
	"testing"
	"time"

	platformjobs "github.com/aedst/server/internal/platform/jobs"
	"github.com/aedst/server/internal/platform/postgrestest"
)

// The queue gauges and the admin lag read river_job: an old available job is
// reported with its age, discarded jobs are counted, and an empty queue is zero.
func TestQueueHealth_ReadsRiverJobState(t *testing.T) {
	pool := postgrestest.NewPool(t)
	ctx := context.Background()
	now := time.Now()

	if age, err := platformjobs.OldestAvailableAge(ctx, pool, now); err != nil || age != 0 {
		t.Fatalf("OldestAvailableAge on an empty queue = %v, %v; want 0", age, err)
	}

	insert := func(state string, scheduled time.Time) {
		t.Helper()
		_, err := pool.Exec(ctx, `INSERT INTO river_job (state, kind, args, max_attempts, queue, scheduled_at, finalized_at)
			VALUES ($1::river_job_state, 'test.kind', '{}', 3, 'default', $2, CASE WHEN $1 = 'discarded' THEN now() END)`, state, scheduled)
		if err != nil {
			t.Fatalf("insert %s job: %v", state, err)
		}
	}
	insert("available", now.Add(-2*time.Minute))
	insert("available", now.Add(-10*time.Second))
	insert("available", now.Add(time.Hour)) // not due yet: not lag
	insert("discarded", now.Add(-time.Hour))

	age, err := platformjobs.OldestAvailableAge(ctx, pool, now)
	if err != nil || age < 119*time.Second || age > 121*time.Second {
		t.Fatalf("OldestAvailableAge = %v, %v; want ~2m (the oldest due job)", age, err)
	}

	counts, oldest, err := platformjobs.ReadQueueSnapshot(ctx, pool, now)
	if err != nil {
		t.Fatal(err)
	}
	if counts["available"] != 3 || counts["discarded"] != 1 {
		t.Fatalf("counts = %v, want available=3 discarded=1", counts)
	}
	if got := now.Sub(oldest); got < 119*time.Second || got > 122*time.Second {
		t.Fatalf("snapshot oldest age = %v, want ~2m", got)
	}
	if err := platformjobs.RegisterMetricsForTest(pool); err != nil {
		t.Fatalf("registerMetrics: %v", err)
	}
}
