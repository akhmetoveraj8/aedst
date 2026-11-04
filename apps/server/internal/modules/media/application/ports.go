// Package application holds the media module's use cases.
package application

import (
	"context"
	"time"

	"github.com/aedst/server/internal/modules/media/domain"
	"github.com/aedst/server/internal/platform/imgproxy"
	"github.com/aedst/server/internal/platform/storage"
	"github.com/aedst/server/internal/shared/ids"
	"github.com/aedst/server/internal/shared/pagination"
)

// Repository persists media rows. StartProcessing and Delete enqueue their
// River jobs (processing / object cleanup) inside their own transaction.
type Repository interface {
	Create(ctx context.Context, m domain.Media) (domain.Media, error)
	Get(ctx context.Context, owner, id ids.ID) (domain.Media, error)
	// StartProcessing moves a pending upload to processing (guarded) and
	// enqueues the processing job in the same transaction. ok=false means the
	// row was no longer pending (a retry or a race): return the current row.
	StartProcessing(ctx context.Context, owner, id ids.ID, size int64, now time.Time) (m domain.Media, ok bool, err error)
	MarkFailed(ctx context.Context, id ids.ID, reason string, now time.Time) error
	// Delete removes the row (and variants), publishes MediaDeleted and
	// enqueues deletion of every stored object, atomically.
	Delete(ctx context.Context, owner, id ids.ID, now time.Time) error
	List(ctx context.Context, p ListParams) (ListResult, error)
	Totals(ctx context.Context) (count, bytes int64, err error)
}

// TaskOwnership checks an attachment target through tasks/api.
type TaskOwnership interface {
	OwnsTask(ctx context.Context, owner, taskID ids.ID) (bool, error)
}

// ObjectStorage is the platform port (S3 / MinIO / R2, or storage.Memory in tests).
type ObjectStorage = storage.ObjectStorage

// ListParams selects one keyset page of an owner's media, newest first.
type ListParams struct {
	OwnerID ids.ID
	TaskID  *ids.ID
	Kinds   []domain.Kind
	Limit   int
	After   *pagination.Cursor
}

// SortToken binds list cursors to their ordering.
const SortToken = "media:created_at:desc"

type ListResult struct {
	Media []domain.Media
	Next  *pagination.Cursor
}

// Config is the module's policy.
type Config struct {
	Limits         domain.Limits
	UploadURLTTL   time.Duration
	DownloadURLTTL time.Duration
	// Delivery signs imgproxy URLs for generic image sizes (ADR-0015). Nil
	// disables derived variants; clients then use the original URL.
	Delivery *imgproxy.Signer
}

// Upload is CreateUpload's result.
type Upload struct {
	Media   domain.Media
	Request storage.PresignedRequest
}

// Links are presigned download URLs of a READY item.
type Links struct {
	Original string
	Variants map[domain.VariantKind]string
	// Derived are signed imgproxy URLs; empty when imgproxy is not enabled.
	Derived []DerivedVariant
}

// DerivedVariant is an on-demand imgproxy rendition of an image (or of a
// video poster). It is never stored: the URL is built from the stored source
// object and the preset. Width/Height are the preset's target box; Height is
// proportional to the source for width-only presets (0 when unknown).
type DerivedVariant struct {
	Kind   domain.VariantKind
	URL    string
	Width  int
	Height int
}
