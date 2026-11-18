package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/rivertype"

	admindb "github.com/aedst/server/gen/db/admin"
	"github.com/aedst/server/internal/modules/admin/application"
	"github.com/aedst/server/internal/modules/admin/domain"
	adminjobs "github.com/aedst/server/internal/modules/admin/jobs"
	sharederrors "github.com/aedst/server/internal/shared/errors"
	"github.com/aedst/server/internal/shared/ids"
)

// TxJobInserter is the part of the River client the repository needs to enqueue
// admin.apply. Satisfied by platform/jobs.Client.
type TxJobInserter interface {
	InsertTx(ctx context.Context, tx pgx.Tx, args river.JobArgs, opts *river.InsertOpts) (*rivertype.JobInsertResult, error)
}

var _ application.ApplyQueue = (*Repository)(nil)

// UseJobs gives the repository the River client (it exists only after the module
// registered its worker, so it is not a constructor argument).
func (r *Repository) UseJobs(jobs TxJobInserter) { r.jobs = jobs }

// InsertPendingTx writes an audit entry in state pending: the first half of an
// audit-first action. Not integration-tested (needs Postgres).
func (r *Repository) InsertPendingTx(ctx context.Context, tx pgx.Tx, e domain.AuditEntry) error {
	meta := e.Metadata
	if meta == nil {
		meta = map[string]any{}
	}
	raw, err := json.Marshal(meta)
	if err != nil {
		return sharederrors.Wrap("admin.audit", err)
	}
	if err := admindb.New(tx).InsertPendingAuditEntry(ctx, admindb.InsertPendingAuditEntryParams{
		ID: toPgUUID(e.ID), ActorID: toPgUUID(e.Actor.UserID), ActorSubject: e.Actor.Subject, ActorIssuer: e.Actor.Issuer,
		Action: e.Action, TargetKind: e.TargetKind, TargetID: e.TargetID, Reason: e.Reason, Metadata: raw,
		CreatedAt: pgtype.Timestamptz{Time: e.CreatedAt, Valid: true},
	}); err != nil {
		return sharederrors.Wrap("admin.audit", err)
	}
	return nil
}

// EnqueueApplyTx inserts the admin.apply job in the caller's transaction, the same
// one that wrote the pending entry: both exist or neither does.
func (r *Repository) EnqueueApplyTx(ctx context.Context, tx pgx.Tx, auditID ids.ID) error {
	if r.jobs == nil {
		return sharederrors.Wrap("admin.apply", errors.New("repository has no River client"))
	}
	if _, err := r.jobs.InsertTx(ctx, tx, adminjobs.ApplyArgs{AuditID: auditID.String()}, nil); err != nil {
		return sharederrors.Wrap("admin.apply", err)
	}
	return nil
}

// Get reads one audit entry with its state. Not integration-tested.
func (r *Repository) Get(ctx context.Context, id ids.ID) (domain.AuditEntry, error) {
	row, err := admindb.New(r.pool).GetAuditEntry(ctx, toPgUUID(id))
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.AuditEntry{}, sharederrors.NotFound("admin.GetAudit", "audit entry not found")
	}
	if err != nil {
		return domain.AuditEntry{}, sharederrors.Wrap("admin.GetAudit", err)
	}
	var meta map[string]any
	_ = json.Unmarshal(row.Metadata, &meta)
	return domain.AuditEntry{
		ID: ids.ID(row.ID.Bytes), Actor: domain.Actor{UserID: ids.ID(row.ActorID.Bytes), Subject: row.ActorSubject, Issuer: row.ActorIssuer},
		Action: row.Action, TargetKind: row.TargetKind, TargetID: row.TargetID, Reason: row.Reason, Metadata: meta,
		CreatedAt: row.CreatedAt.Time, State: domain.State(row.State), Failure: row.Failure,
	}, nil
}

// Resolve moves a pending entry to its final state, once, in one statement on the
// repository's pool (the jobs pool when the admin.apply worker uses it): the entry's other columns are
// immutable (the database trigger refuses anything else). It reports false when
// the entry was no longer pending. Not integration-tested.
func (r *Repository) Resolve(ctx context.Context, id ids.ID, state domain.State, failure string, result map[string]any, at time.Time) (bool, error) {
	if result == nil {
		result = map[string]any{}
	}
	raw, err := json.Marshal(result)
	if err != nil {
		return false, sharederrors.Wrap("admin.ResolveAudit", err)
	}
	n, err := admindb.New(r.pool).ResolveAuditEntry(ctx, admindb.ResolveAuditEntryParams{
		ID: toPgUUID(id), State: string(state), Failure: failure, Result: raw, ResolvedAt: pgtype.Timestamptz{Time: at, Valid: true},
	})
	if err != nil {
		return false, sharederrors.Wrap("admin.ResolveAudit", err)
	}
	return n == 1, nil
}
