package retention_test

import (
	"context"
	"log/slog"
	"testing"
	"time"

	"github.com/riverqueue/river"

	"github.com/aedst/server/internal/platform/retention"
)

func TestRegister_OneLeaderElectedJobPerPolicy(t *testing.T) {
	policy := func(name string) retention.Policy {
		return retention.Policy{Name: name, Retention: time.Hour, Purge: func(context.Context, time.Time, int) (int64, error) { return 0, nil }}
	}
	workers := river.NewWorkers()
	jobs, err := retention.Register(workers, []retention.Policy{policy("a"), policy("b")}, 0, slog.New(slog.DiscardHandler))
	if err != nil {
		t.Fatalf("Register: %v", err)
	}
	if len(jobs) != 2 {
		t.Fatalf("periodic jobs = %d, want one per policy", len(jobs))
	}

	if _, err := retention.Register(river.NewWorkers(), []retention.Policy{policy("dup"), policy("dup")}, time.Hour, slog.New(slog.DiscardHandler)); err == nil {
		t.Fatal("Register accepted two policies with the same name")
	}
}

func TestArgs_DedupesRunningJobsButNotCompletedOnes(t *testing.T) {
	opts := retention.Args{Policy: "x"}.InsertOpts()
	if !opts.UniqueOpts.ByArgs {
		t.Fatal("retention jobs must be unique by policy so a slow purge does not stack")
	}
	for _, state := range opts.UniqueOpts.ByState {
		if state == "completed" {
			t.Fatal("completed jobs must not block the next interval's run")
		}
	}
	if retention.Args.Kind(retention.Args{}) == "" {
		t.Fatal("job kind must be set")
	}
}
