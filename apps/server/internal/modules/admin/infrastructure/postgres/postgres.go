// Package postgres implements the admin module's audit log, its transaction
// runner and the platform statistics it reports.
package postgres

import (
	"context"
	"encoding/json"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	admindb "github.com/aedst/server/gen/db/admin"
	"github.com/aedst/server/internal/modules/admin/application"
	"github.com/aedst/server/internal/modules/admin/domain"
	"github.com/aedst/server/internal/platform/database"
	platformjobs "github.com/aedst/server/internal/platform/jobs"
	sharederrors "github.com/aedst/server/internal/shared/errors"
	"github.com/aedst/server/internal/shared/ids"
	"github.com/aedst/server/internal/shared/pagination"
	sharedtime "github.com/aedst/server/internal/shared/time"
)

type Repository struct {
	stats platformjobs.Stats
	pool  *pgxpool.Pool
	clock sharedtime.Clock
}

// NewRepository builds the admin repository. stats reads the River queue through the
// jobs pool (never river_job through pool).
func NewRepository(pool *pgxpool.Pool, stats platformjobs.Stats, clock sharedtime.Clock) *Repository {
	return &Repository{pool: pool, stats: stats, clock: clock}
}

var (
	_ application.AuditStore    = (*Repository)(nil)
	_ application.Tx            = (*Repository)(nil)
	_ application.PlatformStats = (*Repository)(nil)
)

// Run executes fn in one transaction on the request pool.
func (r *Repository) Run(ctx context.Context, fn func(ctx context.Context, tx pgx.Tx) error) error {
	return database.WithTx(ctx, r.pool, fn)
}

func (r *Repository) InsertTx(ctx context.Context, tx pgx.Tx, e domain.AuditEntry) error {
	meta := e.Metadata
	if meta == nil {
		meta = map[string]any{}
	}
	raw, err := json.Marshal(meta)
	if err != nil {
		return sharederrors.Wrap("admin.audit", err)
	}
	if err := admindb.New(tx).InsertAuditEntry(ctx, admindb.InsertAuditEntryParams{
		ID: toPgUUID(e.ID), ActorID: toPgUUID(e.Actor.UserID), ActorSubject: e.Actor.Subject, ActorIssuer: e.Actor.Issuer,
		Action: e.Action, TargetKind: e.TargetKind, TargetID: e.TargetID, Reason: e.Reason, Metadata: raw,
		CreatedAt: pgtype.Timestamptz{Time: e.CreatedAt, Valid: true},
	}); err != nil {
		return sharederrors.Wrap("admin.audit", err)
	}
	return nil
}

func (r *Repository) List(ctx context.Context, limit int, after *pagination.Cursor) ([]domain.AuditEntry, *pagination.Cursor, error) {
	cursorKey := pgtype.Timestamptz{InfinityModifier: pgtype.Infinity, Valid: true}
	cursorID := pgtype.UUID{Bytes: [16]byte{0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff}, Valid: true}
	if after != nil {
		cursorKey = pgtype.Timestamptz{Time: after.Key, Valid: true}
		cursorID = toPgUUID(after.ID)
	}
	rows, err := admindb.New(r.pool).ListAuditEntries(ctx, admindb.ListAuditEntriesParams{CursorKey: cursorKey, CursorID: cursorID, PageLimit: int32(limit) + 1})
	if err != nil {
		return nil, nil, sharederrors.Wrap("admin.ListAudit", err)
	}
	entries := make([]domain.AuditEntry, len(rows))
	for i, row := range rows {
		var meta map[string]any
		_ = json.Unmarshal(row.Metadata, &meta)
		entries[i] = domain.AuditEntry{
			ID: ids.ID(row.ID.Bytes), Actor: domain.Actor{UserID: ids.ID(row.ActorID.Bytes), Subject: row.ActorSubject, Issuer: row.ActorIssuer},
			Action: row.Action, TargetKind: row.TargetKind, TargetID: row.TargetID, Reason: row.Reason, Metadata: meta,
			CreatedAt: row.CreatedAt.Time,
		}
	}
	page := pagination.NewPage(entries, limit, func(e domain.AuditEntry) pagination.Cursor {
		return pagination.Cursor{Sort: application.AuditSortToken, Key: e.CreatedAt, ID: e.ID}
	})
	return page.Items, page.Next, nil
}

// Purge is the retention policy of the audit log.
func (r *Repository) Purge(ctx context.Context, cutoff time.Time, limit int) (int64, error) {
	n, err := admindb.New(r.pool).PurgeAuditEntries(ctx, admindb.PurgeAuditEntriesParams{Cutoff: pgtype.Timestamptz{Time: cutoff, Valid: true}, RowLimit: int32(limit)})
	if err != nil {
		return 0, sharederrors.Wrap("admin.PurgeAudit", err)
	}
	return n, nil
}

// JobLag is the age of the oldest River job ready to run (event deliveries
// included); it is exposed on the wire as outbox_lag_seconds.
func (r *Repository) JobLag(ctx context.Context) (time.Duration, error) {
	return r.stats.OldestAvailableAge(ctx, r.clock.Now())
}

func (r *Repository) PendingJobs(ctx context.Context) (int64, error) {
	return r.stats.PendingCount(ctx)
}

func toPgUUID(id ids.ID) pgtype.UUID { return pgtype.UUID{Bytes: id, Valid: !id.IsNil()} }
