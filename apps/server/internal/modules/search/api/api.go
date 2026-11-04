// Package api is the search module's public boundary. The module owns a
// read-only projection built from other modules' events; it publishes no
// events of its own.
package api

import (
	"context"

	"github.com/aedst/server/internal/modules/search/application"
	"github.com/aedst/server/internal/modules/search/domain"
	"github.com/aedst/server/internal/shared/ids"
)

type (
	Kind         = domain.Kind
	Hit          = domain.Hit
	SearchResult = application.SearchResult
)

const (
	KindTask  = domain.KindTask
	KindMedia = domain.KindMedia
)

// Service is caller-scoped search.
type Service interface {
	Search(ctx context.Context, ownerID ids.ID, query string, kinds []Kind, pageSize int, token string) (SearchResult, error)
	Suggest(ctx context.Context, ownerID ids.ID, prefix string, limit int) ([]string, error)
}

var _ Service = (*application.Service)(nil)
