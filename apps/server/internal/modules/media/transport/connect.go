// Package transport implements MediaService over media/api.
package transport

import (
	"context"

	"connectrpc.com/connect/v2"
	"google.golang.org/protobuf/types/known/timestamppb"

	mediav1 "github.com/aedst/server/gen/go/aedst/media/v1"
	"github.com/aedst/server/internal/modules/media/api"
	platformauth "github.com/aedst/server/internal/platform/auth"
	"github.com/aedst/server/internal/platform/httpserver"
	sharederrors "github.com/aedst/server/internal/shared/errors"
	"github.com/aedst/server/internal/shared/ids"
)

type Handler struct {
	service api.Service
}

func NewHandler(service api.Service) *Handler { return &Handler{service: service} }

func (h *Handler) CreateUpload(ctx context.Context, req *mediav1.CreateUploadRequest) (*mediav1.CreateUploadResponse, error) {
	owner, err := requireIdentity(ctx)
	if err != nil {
		return nil, err
	}
	taskID, err := optionalID(req.GetTaskId())
	if err != nil {
		return nil, err
	}
	up, err := h.service.CreateUpload(ctx, owner, req.GetFilename(), req.GetContentType(), req.GetSizeBytes(), req.GetSha256(), taskID)
	if err != nil {
		return nil, httpserver.ToConnectError(err)
	}
	return &mediav1.CreateUploadResponse{
		Media:     toProto(up.Media, api.Links{}),
		UploadUrl: up.Request.URL,
		Method:    up.Request.Method,
		Headers:   up.Request.Headers,
		ExpiresAt: timestamppb.New(up.Request.ExpiresAt),
	}, nil
}

func (h *Handler) CompleteUpload(ctx context.Context, req *mediav1.CompleteUploadRequest) (*mediav1.CompleteUploadResponse, error) {
	owner, id, err := ownerAndID(ctx, req.GetId())
	if err != nil {
		return nil, err
	}
	m, err := h.service.CompleteUpload(ctx, owner, id)
	if err != nil {
		return nil, httpserver.ToConnectError(err)
	}
	pm, err := h.withLinks(ctx, m)
	if err != nil {
		return nil, err
	}
	return &mediav1.CompleteUploadResponse{Media: pm}, nil
}

func (h *Handler) GetMedia(ctx context.Context, req *mediav1.GetMediaRequest) (*mediav1.GetMediaResponse, error) {
	owner, id, err := ownerAndID(ctx, req.GetId())
	if err != nil {
		return nil, err
	}
	m, err := h.service.GetMedia(ctx, owner, id)
	if err != nil {
		return nil, httpserver.ToConnectError(err)
	}
	pm, err := h.withLinks(ctx, m)
	if err != nil {
		return nil, err
	}
	return &mediav1.GetMediaResponse{Media: pm}, nil
}

func (h *Handler) ListMedia(ctx context.Context, req *mediav1.ListMediaRequest) (*mediav1.ListMediaResponse, error) {
	owner, err := requireIdentity(ctx)
	if err != nil {
		return nil, err
	}
	taskID, err := optionalID(req.GetTaskId())
	if err != nil {
		return nil, err
	}
	var kinds []api.Kind
	for _, k := range req.GetKinds() {
		if kind, ok := kindFromProto(k); ok {
			kinds = append(kinds, kind)
		}
	}
	res, err := h.service.ListMedia(ctx, owner, taskID, kinds, req.GetPageSize(), req.GetPageToken())
	if err != nil {
		return nil, httpserver.ToConnectError(err)
	}
	out := &mediav1.ListMediaResponse{Media: make([]*mediav1.Media, 0, len(res.Media))}
	for _, m := range res.Media {
		pm, err := h.withLinks(ctx, m)
		if err != nil {
			return nil, err
		}
		out.Media = append(out.Media, pm)
	}
	if res.Next != nil {
		out.NextPageToken = res.Next.Encode()
	}
	return out, nil
}

func (h *Handler) DeleteMedia(ctx context.Context, req *mediav1.DeleteMediaRequest) (*mediav1.DeleteMediaResponse, error) {
	owner, id, err := ownerAndID(ctx, req.GetId())
	if err != nil {
		return nil, err
	}
	if err := h.service.DeleteMedia(ctx, owner, id); err != nil {
		return nil, httpserver.ToConnectError(err)
	}
	return &mediav1.DeleteMediaResponse{}, nil
}

func (h *Handler) withLinks(ctx context.Context, m api.Media) (*mediav1.Media, error) {
	links, err := h.service.Links(ctx, m)
	if err != nil {
		return nil, httpserver.ToConnectError(err)
	}
	return toProto(m, links), nil
}

func toProto(m api.Media, links api.Links) *mediav1.Media {
	out := &mediav1.Media{
		Id:            m.ID.String(),
		Kind:          kindToProto(m.Kind),
		Status:        statusToProto(m.Status),
		Filename:      m.Filename,
		ContentType:   m.ContentType,
		SizeBytes:     m.SizeBytes,
		Width:         int32(m.Width),
		Height:        int32(m.Height),
		DurationMs:    m.DurationMs,
		Url:           links.Original,
		CreatedAt:     timestamppb.New(m.CreatedAt),
		FailureReason: m.FailureReason,
	}
	if out.SizeBytes == 0 {
		out.SizeBytes = m.DeclaredSize
	}
	if m.TaskID != nil {
		out.TaskId = m.TaskID.String()
	}
	for _, v := range m.Variants {
		out.Variants = append(out.Variants, &mediav1.Variant{
			Kind:        variantToProto(v.Kind),
			Url:         links.Variants[v.Kind],
			ContentType: v.ContentType,
			Width:       int32(v.Width),
			Height:      int32(v.Height),
			SizeBytes:   v.SizeBytes,
		})
	}
	for _, d := range links.Derived {
		out.Variants = append(out.Variants, &mediav1.Variant{
			Kind: variantToProto(d.Kind), Url: d.URL, Width: int32(d.Width), Height: int32(d.Height),
		})
	}
	return out
}

func requireIdentity(ctx context.Context) (ids.ID, error) {
	identity, ok := platformauth.FromContext(ctx)
	if !ok {
		return ids.Nil, httpserver.ToConnectError(sharederrors.Unauthorized("media", "missing identity"))
	}
	return identity.UserID, nil
}

func ownerAndID(ctx context.Context, raw string) (ids.ID, ids.ID, error) {
	owner, err := requireIdentity(ctx)
	if err != nil {
		return ids.Nil, ids.Nil, err
	}
	id, err := ids.Parse(raw)
	if err != nil {
		return ids.Nil, ids.Nil, connect.NewError(connect.CodeInvalidArgument, "id must be a UUID")
	}
	return owner, id, nil
}

func optionalID(raw string) (*ids.ID, error) {
	if raw == "" {
		return nil, nil
	}
	id, err := ids.Parse(raw)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, "task_id must be a UUID")
	}
	return &id, nil
}

func kindFromProto(k mediav1.MediaKind) (api.Kind, bool) {
	switch k {
	case mediav1.MediaKind_MEDIA_KIND_IMAGE:
		return api.KindImage, true
	case mediav1.MediaKind_MEDIA_KIND_VIDEO:
		return api.KindVideo, true
	case mediav1.MediaKind_MEDIA_KIND_AUDIO:
		return api.KindAudio, true
	case mediav1.MediaKind_MEDIA_KIND_DOCUMENT:
		return api.KindDocument, true
	default:
		return "", false
	}
}

func kindToProto(k api.Kind) mediav1.MediaKind {
	switch k {
	case api.KindImage:
		return mediav1.MediaKind_MEDIA_KIND_IMAGE
	case api.KindVideo:
		return mediav1.MediaKind_MEDIA_KIND_VIDEO
	case api.KindAudio:
		return mediav1.MediaKind_MEDIA_KIND_AUDIO
	case api.KindDocument:
		return mediav1.MediaKind_MEDIA_KIND_DOCUMENT
	default:
		return mediav1.MediaKind_MEDIA_KIND_UNSPECIFIED
	}
}

func statusToProto(s api.Status) mediav1.MediaStatus {
	switch s {
	case api.StatusPendingUpload:
		return mediav1.MediaStatus_MEDIA_STATUS_PENDING_UPLOAD
	case api.StatusProcessing:
		return mediav1.MediaStatus_MEDIA_STATUS_PROCESSING
	case api.StatusReady:
		return mediav1.MediaStatus_MEDIA_STATUS_READY
	case api.StatusFailed:
		return mediav1.MediaStatus_MEDIA_STATUS_FAILED
	default:
		return mediav1.MediaStatus_MEDIA_STATUS_UNSPECIFIED
	}
}

func variantToProto(v api.VariantKind) mediav1.VariantKind {
	switch v {
	case api.VariantThumb64:
		return mediav1.VariantKind_VARIANT_KIND_THUMB_64
	case api.VariantAvatar256:
		return mediav1.VariantKind_VARIANT_KIND_AVATAR_256
	case api.VariantCard400:
		return mediav1.VariantKind_VARIANT_KIND_CARD_400
	case api.VariantFeed800x600:
		return mediav1.VariantKind_VARIANT_KIND_FEED_800X600
	case api.VariantStory1080x1350:
		return mediav1.VariantKind_VARIANT_KIND_STORY_1080X1350
	case api.VariantPoster:
		return mediav1.VariantKind_VARIANT_KIND_POSTER
	default:
		return mediav1.VariantKind_VARIANT_KIND_UNSPECIFIED
	}
}
