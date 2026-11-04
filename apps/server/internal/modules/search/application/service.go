// Package application holds the search module's use cases: caller-scoped
// Search/Suggest over the projection, and the projector that event consumers
// call to maintain it.
package application

import (
	"context"
	"strings"
	"unicode/utf8"

	"github.com/aedst/server/internal/modules/search/domain"
	sharederrors "github.com/aedst/server/internal/shared/errors"
	"github.com/aedst/server/internal/shared/ids"
)

// SearchParams is one ranked page request.
type SearchParams struct {
	OwnerID ids.ID
	Query   string
	Kinds   []domain.Kind
	Limit   int
	After   *domain.Cursor
	// WithTotal asks for the (capped) total estimate — first page only.
	WithTotal bool
}

// SearchResult is one page.
type SearchResult struct {
	Hits  []domain.Hit
	Next  *domain.Cursor
	Total int
}

// Repository reads the projection.
type Repository interface {
	Search(ctx context.Context, p SearchParams) ([]domain.Hit, error)
	CountMatches(ctx context.Context, p SearchParams, limit int) (int, error)
	Suggest(ctx context.Context, ownerID ids.ID, prefix string, limit int) ([]string, error)
}

// TotalCap bounds the total estimate.
const TotalCap = 1000

type Service struct {
	repo Repository
}

func NewService(repo Repository) *Service { return &Service{repo: repo} }

// Search returns one ranked page of the caller's documents. token is the
// opaque cursor of the previous page.
func (s *Service) Search(ctx context.Context, ownerID ids.ID, query string, kinds []domain.Kind, pageSize int, token string) (SearchResult, error) {
	q, err := domain.NormalizeQuery(query)
	if err != nil {
		return SearchResult{}, err
	}
	after, err := domain.DecodeCursor(token, q)
	if err != nil {
		return SearchResult{}, sharederrors.Validation("search.Search", "invalid page token")
	}
	p := SearchParams{
		OwnerID: ownerID, Query: q, Kinds: kinds,
		Limit: domain.ClampPageSize(pageSize, domain.DefaultPageSize, domain.MaxPageSize),
		After: after, WithTotal: after == nil,
	}
	fetch := p
	fetch.Limit = p.Limit + 1
	hits, err := s.repo.Search(ctx, fetch)
	if err != nil {
		return SearchResult{}, err
	}
	res := SearchResult{Hits: hits}
	if len(hits) > p.Limit {
		res.Hits = hits[:p.Limit]
		last := res.Hits[p.Limit-1]
		res.Next = &domain.Cursor{Query: q, Score: last.Score, ID: last.EntityID}
	}
	if p.WithTotal {
		if res.Next == nil {
			res.Total = len(res.Hits)
		} else if res.Total, err = s.repo.CountMatches(ctx, p, TotalCap); err != nil {
			return SearchResult{}, err
		}
	}
	return res, nil
}

// Suggest returns title suggestions for a search box.
func (s *Service) Suggest(ctx context.Context, ownerID ids.ID, prefix string, limit int) ([]string, error) {
	prefix = strings.TrimSpace(prefix)
	if prefix == "" || utf8.RuneCountInString(prefix) > domain.MaxPrefixLength {
		return nil, sharederrors.Validation("search.Suggest", "prefix must be 1-100 characters")
	}
	return s.repo.Suggest(ctx, ownerID, prefix, domain.ClampPageSize(limit, domain.DefaultSuggest, domain.MaxSuggest))
}
