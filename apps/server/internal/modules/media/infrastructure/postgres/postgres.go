// Package postgres implements the media repository (gen/db/media) including
// the transactional side effects: processing/cleanup jobs enqueued and
// MediaReady/MediaDeleted events written in the same transaction as the row
// change.
package postgres

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/rivertype"

	mediadb "github.com/aedst/server/gen/db/media"
	"github.com/aedst/server/internal/modules/media/api"
	"github.com/aedst/server/internal/modules/media/application"
	"github.com/aedst/server/internal/modules/media/domain"
	mediajobs "github.com/aedst/server/internal/modules/media/infrastructure/jobs"
	"github.com/aedst/server/internal/platform/database"
	sharederrors "github.com/aedst/server/internal/shared/errors"
	"github.com/aedst/server/internal/shared/ids"
	"github.com/aedst/server/internal/shared/pagination"
	sharedtime "github.com/aedst/server/internal/shared/time"
)

// TxInserter is the subset of the River client used to enqueue jobs inside a
// transaction.
type TxInserter interface {
	InsertTx(ctx context.Context, tx pgx.Tx, args river.JobArgs, opts *river.InsertOpts) (*rivertype.JobInsertResult, error)
}

// EventWriter is satisfied by events.Publisher.
type EventWriter interface {
	Publish(ctx context.Context, tx pgx.Tx, eventType string, version uint32, partitionKey ids.ID, payload any) (ids.ID, error)
}

type Repository struct {
	pool   *pgxpool.Pool
	jobs   TxInserter
	events EventWriter
	clock  sharedtime.Clock
}

func NewRepository(pool *pgxpool.Pool, jobs TxInserter, publisher EventWriter, clock sharedtime.Clock) *Repository {
	return &Repository{pool: pool, jobs: jobs, events: publisher, clock: clock}
}

var _ application.Repository = (*Repository)(nil)

func (r *Repository) Create(ctx context.Context, m domain.Media) (domain.Media, error) {
	row, err := mediadb.New(r.pool).CreateMedia(ctx, mediadb.CreateMediaParams{
		ID: toPgUUID(m.ID), OwnerID: toPgUUID(m.OwnerID), Kind: string(m.Kind), Filename: m.Filename,
		ContentType: m.ContentType, DeclaredSize: m.DeclaredSize, ObjectKey: m.ObjectKey, Sha256: m.SHA256,
		TaskID: toPgUUIDPtr(m.TaskID), CreatedAt: toTS(m.CreatedAt),
	})
	if err != nil {
		return domain.Media{}, sharederrors.Wrap("media.Create", err)
	}
	return fromDB(row), nil
}

func (r *Repository) Get(ctx context.Context, owner, id ids.ID) (domain.Media, error) {
	row, err := mediadb.New(r.pool).GetMedia(ctx, mediadb.GetMediaParams{ID: toPgUUID(id), OwnerID: toPgUUID(owner)})
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.Media{}, sharederrors.NotFound("media.Get", "media not found")
	}
	if err != nil {
		return domain.Media{}, sharederrors.Wrap("media.Get", err)
	}
	return r.withVariants(ctx, r.pool, fromDB(row))
}

// GetByID is the worker's unscoped read.
func (r *Repository) GetByID(ctx context.Context, id ids.ID) (domain.Media, error) {
	row, err := mediadb.New(r.pool).GetMediaByID(ctx, toPgUUID(id))
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.Media{}, sharederrors.NotFound("media.GetByID", "media not found")
	}
	if err != nil {
		return domain.Media{}, sharederrors.Wrap("media.GetByID", err)
	}
	return fromDB(row), nil
}

func (r *Repository) withVariants(ctx context.Context, db mediadb.DBTX, m domain.Media) (domain.Media, error) {
	items, err := r.attachVariants(ctx, db, []domain.Media{m})
	if err != nil {
		return domain.Media{}, err
	}
	return items[0], nil
}

func (r *Repository) attachVariants(ctx context.Context, db mediadb.DBTX, items []domain.Media) ([]domain.Media, error) {
	if len(items) == 0 {
		return items, nil
	}
	idx := make(map[ids.ID]int, len(items))
	pg := make([]pgtype.UUID, len(items))
	for i, m := range items {
		idx[m.ID] = i
		pg[i] = toPgUUID(m.ID)
	}
	rows, err := mediadb.New(db).ListVariants(ctx, pg)
	if err != nil {
		return nil, sharederrors.Wrap("media.variants", err)
	}
	for _, v := range rows {
		i := idx[ids.ID(v.MediaID.Bytes)]
		items[i].Variants = append(items[i].Variants, domain.Variant{
			Kind: domain.VariantKind(v.Kind), ObjectKey: v.ObjectKey, ContentType: v.ContentType,
			Width: int(v.Width), Height: int(v.Height), SizeBytes: v.SizeBytes,
		})
	}
	return items, nil
}

func (r *Repository) StartProcessing(ctx context.Context, owner, id ids.ID, size int64, now time.Time) (domain.Media, bool, error) {
	var (
		result domain.Media
		ok     bool
	)
	err := database.WithTx(ctx, r.pool, func(ctx context.Context, tx pgx.Tx) error {
		row, err := mediadb.New(tx).StartProcessing(ctx, mediadb.StartProcessingParams{SizeBytes: size, Now: toTS(now), ID: toPgUUID(id), OwnerID: toPgUUID(owner)})
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		if err != nil {
			return sharederrors.Wrap("media.StartProcessing", err)
		}
		result, ok = fromDB(row), true
		if _, err := r.jobs.InsertTx(ctx, tx, mediajobs.ProcessArgs{MediaID: id.String()}, nil); err != nil {
			return sharederrors.Wrap("media.StartProcessing.enqueue", err)
		}
		return nil
	})
	if err != nil {
		return domain.Media{}, false, err
	}
	return result, ok, nil
}

func (r *Repository) MarkFailed(ctx context.Context, id ids.ID, reason string, now time.Time) error {
	if _, err := mediadb.New(r.pool).MarkFailed(ctx, mediadb.MarkFailedParams{Reason: reason, Now: toTS(now), ID: toPgUUID(id)}); err != nil {
		return sharederrors.Wrap("media.MarkFailed", err)
	}
	return nil
}

// MarkReady stores the variants and moves processing -> ready, publishing
// MediaReady, all in one transaction. A row that is no longer processing
// (a retried job after a successful commit) changes nothing.
func (r *Repository) MarkReady(ctx context.Context, id ids.ID, width, height int, durationMs int64, variants []domain.Variant) error {
	return database.WithTx(ctx, r.pool, func(ctx context.Context, tx pgx.Tx) error {
		q := mediadb.New(tx)
		for _, v := range variants {
			if err := q.UpsertVariant(ctx, mediadb.UpsertVariantParams{
				MediaID: toPgUUID(id), Kind: string(v.Kind), ObjectKey: v.ObjectKey, ContentType: v.ContentType,
				Width: int32(v.Width), Height: int32(v.Height), SizeBytes: v.SizeBytes,
			}); err != nil {
				return sharederrors.Wrap("media.MarkReady.variant", err)
			}
		}
		now := r.clock.Now()
		row, err := q.MarkReady(ctx, mediadb.MarkReadyParams{Width: int32(width), Height: int32(height), DurationMs: durationMs, Now: toTS(now), ID: toPgUUID(id)})
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		if err != nil {
			return sharederrors.Wrap("media.MarkReady", err)
		}
		m := fromDB(row)
		evt := api.MediaReadyEvent{
			MediaID: m.ID.String(), UserID: m.OwnerID.String(), Kind: string(m.Kind), Filename: m.Filename,
			ContentType: m.ContentType, SizeBytes: m.SizeBytes, ReadyAt: now, Version: m.Version,
		}
		if m.TaskID != nil {
			evt.TaskID = m.TaskID.String()
		}
		return r.writeEvent(ctx, tx, api.MediaReadyEventType, api.MediaReadyEventVersion, m.ID, evt)
	})
}

func (r *Repository) Delete(ctx context.Context, owner, id ids.ID, now time.Time) error {
	return database.WithTx(ctx, r.pool, func(ctx context.Context, tx pgx.Tx) error {
		q := mediadb.New(tx)
		variants, err := q.ListVariants(ctx, []pgtype.UUID{toPgUUID(id)})
		if err != nil {
			return sharederrors.Wrap("media.Delete", err)
		}
		row, err := q.DeleteMedia(ctx, mediadb.DeleteMediaParams{ID: toPgUUID(id), OwnerID: toPgUUID(owner)})
		if errors.Is(err, pgx.ErrNoRows) {
			return sharederrors.NotFound("media.Delete", "media not found")
		}
		if err != nil {
			return sharederrors.Wrap("media.Delete", err)
		}
		keys := []string{row.ObjectKey}
		for _, v := range variants {
			keys = append(keys, v.ObjectKey)
		}
		if _, err := r.jobs.InsertTx(ctx, tx, mediajobs.DeleteObjectsArgs{Keys: keys}, nil); err != nil {
			return sharederrors.Wrap("media.Delete.enqueue", err)
		}
		return r.writeEvent(ctx, tx, api.MediaDeletedEventType, api.MediaDeletedEventVersion, id, api.MediaDeletedEvent{
			MediaID: id.String(), UserID: owner.String(), DeletedAt: now, Version: int(row.Version) + 1,
		})
	})
}

// PurgeAbandoned is the retention policy of PENDING_UPLOAD rows older than
// cutoff: it deletes up to limit rows and enqueues deletion of any object a
// client may have uploaded for them, in one transaction.
func (r *Repository) PurgeAbandoned(ctx context.Context, cutoff time.Time, limit int) (int64, error) {
	var n int64
	err := database.WithTx(ctx, r.pool, func(ctx context.Context, tx pgx.Tx) error {
		q := mediadb.New(tx)
		rows, err := q.ClaimAbandonedUploads(ctx, mediadb.ClaimAbandonedUploadsParams{Cutoff: toTS(cutoff), RowLimit: int32(limit)})
		if err != nil {
			return sharederrors.Wrap("media.PurgeAbandoned", err)
		}
		if len(rows) == 0 {
			return nil
		}
		pg := make([]pgtype.UUID, len(rows))
		keys := make([]string, len(rows))
		for i, row := range rows {
			pg[i], keys[i] = row.ID, row.ObjectKey
		}
		if n, err = q.DeleteMediaByIDs(ctx, pg); err != nil {
			return sharederrors.Wrap("media.PurgeAbandoned", err)
		}
		if _, err := r.jobs.InsertTx(ctx, tx, mediajobs.DeleteObjectsArgs{Keys: keys}, nil); err != nil {
			return sharederrors.Wrap("media.PurgeAbandoned.enqueue", err)
		}
		return nil
	})
	return n, err
}

func (r *Repository) List(ctx context.Context, p application.ListParams) (application.ListResult, error) {
	cursorKey := pgtype.Timestamptz{InfinityModifier: pgtype.Infinity, Valid: true}
	cursorID := pgtype.UUID{Bytes: [16]byte{0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff}, Valid: true}
	if p.After != nil {
		cursorKey, cursorID = toTS(p.After.Key), toPgUUID(p.After.ID)
	}
	kinds := make([]string, len(p.Kinds))
	for i, k := range p.Kinds {
		kinds[i] = string(k)
	}
	rows, err := mediadb.New(r.pool).ListMediaPage(ctx, mediadb.ListMediaPageParams{
		OwnerID: toPgUUID(p.OwnerID), TaskID: toPgUUIDPtr(p.TaskID), Kinds: kinds,
		CursorKey: cursorKey, CursorID: cursorID, PageLimit: int32(p.Limit) + 1,
	})
	if err != nil {
		return application.ListResult{}, sharederrors.Wrap("media.List", err)
	}
	items := make([]domain.Media, len(rows))
	for i, row := range rows {
		items[i] = fromDB(row)
	}
	page := pagination.NewPage(items, p.Limit, func(m domain.Media) pagination.Cursor {
		return pagination.Cursor{Sort: application.SortToken, Key: m.CreatedAt, ID: m.ID}
	})
	withVariants, err := r.attachVariants(ctx, r.pool, page.Items)
	if err != nil {
		return application.ListResult{}, err
	}
	return application.ListResult{Media: withVariants, Next: page.Next}, nil
}

func (r *Repository) Totals(ctx context.Context) (int64, int64, error) {
	row, err := mediadb.New(r.pool).MediaTotals(ctx)
	if err != nil {
		return 0, 0, sharederrors.Wrap("media.Totals", err)
	}
	return row.Total, row.Bytes, nil
}

func (r *Repository) writeEvent(ctx context.Context, tx pgx.Tx, eventType string, version uint32, key ids.ID, payload any) error {
	if _, err := r.events.Publish(ctx, tx, eventType, version, key, payload); err != nil {
		return sharederrors.Wrap("media.writeEvent", err)
	}
	return nil
}

func fromDB(row mediadb.MediaMedium) domain.Media {
	m := domain.Media{
		ID: ids.ID(row.ID.Bytes), OwnerID: ids.ID(row.OwnerID.Bytes), Kind: domain.Kind(row.Kind),
		Status: domain.Status(row.Status), Filename: row.Filename, ContentType: row.ContentType,
		DeclaredSize: row.DeclaredSize, SizeBytes: row.SizeBytes, Width: int(row.Width), Height: int(row.Height),
		DurationMs: row.DurationMs, ObjectKey: row.ObjectKey, SHA256: row.Sha256, FailureReason: row.FailureReason,
		Version: int(row.Version), CreatedAt: row.CreatedAt.Time, UpdatedAt: row.UpdatedAt.Time,
	}
	if row.TaskID.Valid {
		t := ids.ID(row.TaskID.Bytes)
		m.TaskID = &t
	}
	return m
}

func toTS(t time.Time) pgtype.Timestamptz { return pgtype.Timestamptz{Time: t, Valid: true} }

func toPgUUID(id ids.ID) pgtype.UUID { return pgtype.UUID{Bytes: id, Valid: !id.IsNil()} }

func toPgUUIDPtr(id *ids.ID) pgtype.UUID {
	if id == nil {
		return pgtype.UUID{}
	}
	return toPgUUID(*id)
}
