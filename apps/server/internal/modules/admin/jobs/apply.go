// Package jobs holds admin's River job kind: admin.apply, the second half of an
// audit-first operator action (see application/audit_first.go). It is registered
// with the shared River client by the module's Setup.
package jobs

import (
	"context"
	"fmt"

	"github.com/riverqueue/river"

	"github.com/aedst/server/internal/shared/ids"
)

// ApplyKind is the River job kind. Persisted in job rows: never rename it.
const ApplyKind = "admin.apply"

// maxAttempts bounds the retries with River's default backoff (attempt^4
// seconds, about 2.5 hours in total): long enough to ride out a deploy or an
// outage of the owning module, short enough that an entry does not stay pending
// for days. The last attempt resolves the entry as failed (application.Applier).
const maxAttempts = 10

// ApplyArgs is the payload of the job: only the audit entry id. Everything else
// is read from the entry, so a retry always acts on what was recorded.
type ApplyArgs struct {
	AuditID string `json:"audit_id" river:"unique"`
}

// Kind implements river.JobArgs.
func (ApplyArgs) Kind() string { return ApplyKind }

// InsertOpts implements river.JobArgsWithInsertOpts: unique per entry, so an
// entry can never have two jobs.
func (ApplyArgs) InsertOpts() river.InsertOpts {
	return river.InsertOpts{MaxAttempts: maxAttempts, UniqueOpts: river.UniqueOpts{ByArgs: true}}
}

// Applier performs one entry (application.Applier).
type Applier interface {
	Apply(ctx context.Context, id ids.ID, lastAttempt bool) error
}

// ApplyWorker runs admin.apply.
type ApplyWorker struct {
	river.WorkerDefaults[ApplyArgs]

	Applier Applier
}

// NewApplyWorker builds the worker.
func NewApplyWorker(a Applier) *ApplyWorker { return &ApplyWorker{Applier: a} }

// Work applies the entry. A malformed id can never succeed, so it is cancelled
// instead of retried; any other error is returned for River's backoff, except
// that the Applier itself resolves the entry on the last attempt.
func (w *ApplyWorker) Work(ctx context.Context, job *river.Job[ApplyArgs]) error {
	id, err := ids.Parse(job.Args.AuditID)
	if err != nil {
		return river.JobCancel(fmt.Errorf("admin.apply: audit id: %w", err))
	}
	return w.Applier.Apply(ctx, id, job.Attempt >= job.MaxAttempts)
}
