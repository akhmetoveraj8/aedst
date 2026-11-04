// Package transport implements SearchService over search/api.
package transport

import (
	"context"

	"google.golang.org/protobuf/types/known/timestamppb"

	searchv1 "github.com/aedst/server/gen/go/aedst/search/v1"
	"github.com/aedst/server/internal/modules/search/api"
	platformauth "github.com/aedst/server/internal/platform/auth"
	"github.com/aedst/server/internal/platform/httpserver"
	sharederrors "github.com/aedst/server/internal/shared/errors"
	"github.com/aedst/server/internal/shared/ids"
)

type Handler struct {
	service api.Service
}

func NewHandler(service api.Service) *Handler { return &Handler{service: service} }

func (h *Handler) Search(ctx context.Context, req *searchv1.SearchRequest) (*searchv1.SearchResponse, error) {
	userID, err := requireIdentity(ctx)
	if err != nil {
		return nil, err
	}
	kinds := make([]api.Kind, 0, len(req.GetKinds()))
	for _, k := range req.GetKinds() {
		if kind, ok := kindFromProto(k); ok {
			kinds = append(kinds, kind)
		}
	}
	res, err := h.service.Search(ctx, userID, req.GetQuery(), kinds, int(req.GetPageSize()), req.GetPageToken())
	if err != nil {
		return nil, httpserver.ToConnectError(err)
	}
	out := &searchv1.SearchResponse{Hits: make([]*searchv1.SearchHit, 0, len(res.Hits)), TotalEstimate: int32(res.Total)}
	for _, hit := range res.Hits {
		out.Hits = append(out.Hits, &searchv1.SearchHit{
			Kind:      kindToProto(hit.Kind),
			Id:        hit.EntityID.String(),
			Title:     hit.Title,
			Snippet:   hit.Snippet,
			Score:     float32(hit.Score),
			Link:      hit.Link,
			UpdatedAt: timestamppb.New(hit.UpdatedAt),
		})
	}
	if res.Next != nil {
		out.NextPageToken = res.Next.Encode()
	}
	return out, nil
}

func (h *Handler) Suggest(ctx context.Context, req *searchv1.SuggestRequest) (*searchv1.SuggestResponse, error) {
	userID, err := requireIdentity(ctx)
	if err != nil {
		return nil, err
	}
	s, err := h.service.Suggest(ctx, userID, req.GetPrefix(), int(req.GetLimit()))
	if err != nil {
		return nil, httpserver.ToConnectError(err)
	}
	return &searchv1.SuggestResponse{Suggestions: s}, nil
}

func requireIdentity(ctx context.Context) (ids.ID, error) {
	identity, ok := platformauth.FromContext(ctx)
	if !ok {
		return ids.Nil, httpserver.ToConnectError(sharederrors.Unauthorized("search", "missing identity"))
	}
	return identity.UserID, nil
}

func kindFromProto(k searchv1.DocumentKind) (api.Kind, bool) {
	switch k {
	case searchv1.DocumentKind_DOCUMENT_KIND_TASK:
		return api.KindTask, true
	case searchv1.DocumentKind_DOCUMENT_KIND_MEDIA:
		return api.KindMedia, true
	default:
		return "", false
	}
}

func kindToProto(k api.Kind) searchv1.DocumentKind {
	switch k {
	case api.KindTask:
		return searchv1.DocumentKind_DOCUMENT_KIND_TASK
	case api.KindMedia:
		return searchv1.DocumentKind_DOCUMENT_KIND_MEDIA
	default:
		return searchv1.DocumentKind_DOCUMENT_KIND_UNSPECIFIED
	}
}
