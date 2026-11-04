// Package api is the media module's public boundary: the owner-scoped
// Service (transport), Totals for the admin overview, and the integration
// events in events.go.
package api

import (
	"context"

	"github.com/aedst/server/internal/modules/media/application"
	"github.com/aedst/server/internal/modules/media/domain"
	"github.com/aedst/server/internal/shared/ids"
)

type (
	Media       = domain.Media
	Kind        = domain.Kind
	Status      = domain.Status
	Variant     = domain.Variant
	VariantKind = domain.VariantKind
	Upload      = application.Upload
	Links       = application.Links
	ListResult  = application.ListResult
)

const (
	KindImage    = domain.KindImage
	KindVideo    = domain.KindVideo
	KindAudio    = domain.KindAudio
	KindDocument = domain.KindDocument

	StatusPendingUpload = domain.StatusPendingUpload
	StatusProcessing    = domain.StatusProcessing
	StatusReady         = domain.StatusReady
	StatusFailed        = domain.StatusFailed

	VariantPoster = domain.VariantPoster

	VariantThumb64        = domain.VariantThumb64
	VariantAvatar256      = domain.VariantAvatar256
	VariantCard400        = domain.VariantCard400
	VariantFeed800x600    = domain.VariantFeed800x600
	VariantStory1080x1350 = domain.VariantStory1080x1350
)

// Service is everything the transport can do; every method is owner-scoped.
type Service interface {
	CreateUpload(ctx context.Context, owner ids.ID, filename, contentType string, size int64, sha256Hex string, taskID *ids.ID) (Upload, error)
	CompleteUpload(ctx context.Context, owner, id ids.ID) (Media, error)
	GetMedia(ctx context.Context, owner, id ids.ID) (Media, error)
	ListMedia(ctx context.Context, owner ids.ID, taskID *ids.ID, kinds []Kind, pageSize int32, token string) (ListResult, error)
	DeleteMedia(ctx context.Context, owner, id ids.ID) error
	Links(ctx context.Context, m Media) (Links, error)
}

// Stats is the operator view (admin overview).
type Stats interface {
	Totals(ctx context.Context) (count, bytes int64, err error)
}

var (
	_ Service = (*application.Service)(nil)
	_ Stats   = (*application.Service)(nil)
)
