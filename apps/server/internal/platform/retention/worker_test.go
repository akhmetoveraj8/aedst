package retention

import (
	"context"
	"errors"
	"log/slog"
	"testing"
	"time"

	"github.com/riverqueue/river"
	"github.com/riverqueue/river/rivertype"
	"go.opentelemetry.io/otel/metric/noop"
)

func newTestWorker(t *testing.T, policies ...Policy) *Worker {
	t.Helper()
	counter, err := noop.NewMeterProvider().Meter("test").Int64Counter("c")
	if err != nil {
		t.Fatal(err)
	}
	w := &Worker{policies: map[string]Policy{}, logger: slog.New(slog.DiscardHandler), purged: counter, now: func() time.Time { return time.Unix(1_000_000, 0) }}
	for _, p := range policies {
		w.policies[p.Name] = p
	}
	return w
}

func job(policy string) *river.Job[Args] {
	return &river.Job[Args]{JobRow: &rivertype.JobRow{}, Args: Args{Policy: policy}}
}

func TestWorker_DrainsInBatchesUntilAShortBatch(t *testing.T) {
	var cutoffs []time.Time
	batches := []int64{batchSize, batchSize, 3}
	w := newTestWorker(t, Policy{Name: "x", Retention: 10 * time.Second, Purge: func(_ context.Context, cutoff time.Time, limit int) (int64, error) {
		if limit != batchSize {
			t.Errorf("limit = %d, want the batch size", limit)
		}
		cutoffs = append(cutoffs, cutoff)
		n := batches[0]
		batches = batches[1:]
		return n, nil
	}})
	if err := w.Work(context.Background(), job("x")); err != nil {
		t.Fatalf("Work: %v", err)
	}
	if len(cutoffs) != 3 {
		t.Fatalf("purge calls = %d, want 3 (two full batches, then the short one)", len(cutoffs))
	}
	if want := time.Unix(1_000_000-10, 0); !cutoffs[0].Equal(want) {
		t.Errorf("cutoff = %v, want now minus the retention (%v)", cutoffs[0], want)
	}
}

func TestWorker_ErrorsRetryAndUnknownPoliciesCancel(t *testing.T) {
	boom := errors.New("boom")
	w := newTestWorker(t, Policy{Name: "x", Retention: time.Hour, Purge: func(context.Context, time.Time, int) (int64, error) { return 0, boom }})
	if err := w.Work(context.Background(), job("x")); !errors.Is(err, boom) {
		t.Fatalf("Work = %v, want the purge error so River retries", err)
	}
	var cancel *river.JobCancelError
	if err := w.Work(context.Background(), job("gone")); !errors.As(err, &cancel) {
		t.Fatalf("Work(unknown policy) = %v, want a JobCancel (a removed policy must not retry forever)", err)
	}
}

func TestWorker_StopsWhenContextIsCancelled(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	calls := 0
	w := newTestWorker(t, Policy{Name: "x", Retention: time.Hour, Purge: func(context.Context, time.Time, int) (int64, error) {
		calls++
		cancel()
		return batchSize, nil // more to do, but we are shutting down
	}})
	if err := w.Work(ctx, job("x")); err != nil || calls != 1 {
		t.Fatalf("Work = %v after %d purges; want a clean stop after the in-flight batch", err, calls)
	}
}
