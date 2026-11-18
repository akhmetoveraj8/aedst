package jobs_test

import (
	"context"
	"errors"
	"testing"

	"github.com/riverqueue/river"
	"github.com/riverqueue/river/rivertype"

	"github.com/aedst/server/internal/modules/admin/jobs"
	"github.com/aedst/server/internal/shared/ids"
)

type applier struct {
	id   ids.ID
	last bool
	err  error
}

func (a *applier) Apply(_ context.Context, id ids.ID, last bool) error {
	a.id, a.last = id, last
	return a.err
}

func job(auditID string, attempt, max int) *river.Job[jobs.ApplyArgs] {
	return &river.Job[jobs.ApplyArgs]{
		JobRow: &rivertype.JobRow{Attempt: attempt, MaxAttempts: max},
		Args:   jobs.ApplyArgs{AuditID: auditID},
	}
}

func TestApplyWorker_PassesTheEntryAndWhetherItIsTheLastAttempt(t *testing.T) {
	id := ids.New()
	for _, tc := range []struct {
		attempt, max int
		wantLast     bool
	}{{1, 10, false}, {9, 10, false}, {10, 10, true}} {
		a := &applier{}
		if err := jobs.NewApplyWorker(a).Work(context.Background(), job(id.String(), tc.attempt, tc.max)); err != nil {
			t.Fatal(err)
		}
		if a.id != id || a.last != tc.wantLast {
			t.Errorf("attempt %d/%d: applied %v last=%v, want %v last=%v", tc.attempt, tc.max, a.id, a.last, id, tc.wantLast)
		}
	}
}

func TestApplyWorker_ReturnsTheApplierErrorForRetry(t *testing.T) {
	boom := errors.New("owner is down")
	err := jobs.NewApplyWorker(&applier{err: boom}).Work(context.Background(), job(ids.New().String(), 1, 10))
	if !errors.Is(err, boom) {
		t.Fatalf("err = %v, want the applier's error so River retries", err)
	}
}

func TestApplyWorker_CancelsAMalformedID(t *testing.T) {
	a := &applier{}
	err := jobs.NewApplyWorker(a).Work(context.Background(), job("not-a-uuid", 1, 10))
	if _, ok := errors.AsType[*river.JobCancelError](err); !ok {
		t.Fatalf("err = %v, want a JobCancel (it can never succeed)", err)
	}
	if !a.id.IsNil() {
		t.Error("the applier ran for a malformed id")
	}
}

func TestApplyArgs_AreUniquePerEntryWithBoundedRetries(t *testing.T) {
	opts := jobs.ApplyArgs{}.InsertOpts()
	if !opts.UniqueOpts.ByArgs || opts.MaxAttempts != 10 {
		t.Errorf("opts = %+v", opts)
	}
	if jobs.ApplyKind != "admin.apply" {
		t.Errorf("kind = %q: it is persisted in job rows", jobs.ApplyKind)
	}
}
