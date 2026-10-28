// Package transport implements NotificationsService. It depends only on
// modules/notifications/api and derives the caller from platform/auth.
package transport

import (
	"context"

	"connectrpc.com/connect/v2"
	"google.golang.org/protobuf/types/known/timestamppb"

	notificationsv1 "github.com/aedst/server/gen/go/aedst/notifications/v1"
	"github.com/aedst/server/internal/modules/notifications/api"
	platformauth "github.com/aedst/server/internal/platform/auth"
	"github.com/aedst/server/internal/platform/httpserver"
	sharederrors "github.com/aedst/server/internal/shared/errors"
	"github.com/aedst/server/internal/shared/ids"
)

type Handler struct {
	service api.Service
}

func NewHandler(service api.Service) *Handler { return &Handler{service: service} }

func (h *Handler) ListNotifications(ctx context.Context, req *notificationsv1.ListNotificationsRequest) (*notificationsv1.ListNotificationsResponse, error) {
	userID, err := requireIdentity(ctx)
	if err != nil {
		return nil, err
	}
	res, err := h.service.ListNotifications(ctx, userID, req.GetUnreadOnly(), req.GetPageSize(), req.GetPageToken())
	if err != nil {
		return nil, httpserver.ToConnectError(err)
	}
	out := &notificationsv1.ListNotificationsResponse{Notifications: make([]*notificationsv1.Notification, 0, len(res.Notifications))}
	for _, n := range res.Notifications {
		out.Notifications = append(out.Notifications, toProto(n))
	}
	if res.Next != nil {
		out.NextPageToken = res.Next.Encode()
	}
	return out, nil
}

func (h *Handler) GetUnreadCount(ctx context.Context, _ *notificationsv1.GetUnreadCountRequest) (*notificationsv1.GetUnreadCountResponse, error) {
	userID, err := requireIdentity(ctx)
	if err != nil {
		return nil, err
	}
	n, err := h.service.GetUnreadCount(ctx, userID)
	if err != nil {
		return nil, httpserver.ToConnectError(err)
	}
	return &notificationsv1.GetUnreadCountResponse{Unread: int32(n)}, nil
}

func (h *Handler) MarkRead(ctx context.Context, req *notificationsv1.MarkReadRequest) (*notificationsv1.MarkReadResponse, error) {
	userID, err := requireIdentity(ctx)
	if err != nil {
		return nil, err
	}
	parsed := make([]ids.ID, 0, len(req.GetIds()))
	for _, raw := range req.GetIds() {
		id, err := ids.Parse(raw)
		if err != nil {
			return nil, connect.NewError(connect.CodeInvalidArgument, "ids must be UUIDs")
		}
		parsed = append(parsed, id)
	}
	if err := h.service.MarkRead(ctx, userID, parsed...); err != nil {
		return nil, httpserver.ToConnectError(err)
	}
	return &notificationsv1.MarkReadResponse{}, nil
}

func (h *Handler) MarkAllRead(ctx context.Context, _ *notificationsv1.MarkAllReadRequest) (*notificationsv1.MarkAllReadResponse, error) {
	userID, err := requireIdentity(ctx)
	if err != nil {
		return nil, err
	}
	n, err := h.service.MarkAllRead(ctx, userID)
	if err != nil {
		return nil, httpserver.ToConnectError(err)
	}
	return &notificationsv1.MarkAllReadResponse{Marked: int32(n)}, nil
}

func (h *Handler) RegisterPushDevice(ctx context.Context, req *notificationsv1.RegisterPushDeviceRequest) (*notificationsv1.RegisterPushDeviceResponse, error) {
	userID, err := requireIdentity(ctx)
	if err != nil {
		return nil, err
	}
	m := req
	var platform api.Platform
	switch m.GetPlatform() {
	case notificationsv1.PushPlatform_PUSH_PLATFORM_WEB_PUSH:
		platform = api.PlatformWebPush
		if m.GetWebPush() == nil {
			return nil, connect.NewError(connect.CodeInvalidArgument, "web_push subscription is required for PUSH_PLATFORM_WEB_PUSH")
		}
	case notificationsv1.PushPlatform_PUSH_PLATFORM_FCM:
		platform = api.PlatformFCM
	case notificationsv1.PushPlatform_PUSH_PLATFORM_APNS:
		platform = api.PlatformAPNs
	default:
		return nil, connect.NewError(connect.CodeInvalidArgument, "platform is required")
	}
	wp := m.GetWebPush()
	id, err := h.service.RegisterPushDevice(ctx, userID, platform, m.GetToken(), wp.GetEndpoint(), wp.GetP256Dh(), wp.GetAuth(),
		m.GetApnsTopic(), m.GetApnsSandbox(), m.GetDeviceName(), m.GetLocale())
	if err != nil {
		return nil, httpserver.ToConnectError(err)
	}
	return &notificationsv1.RegisterPushDeviceResponse{DeviceId: id.String()}, nil
}

func (h *Handler) UnregisterPushDevice(ctx context.Context, req *notificationsv1.UnregisterPushDeviceRequest) (*notificationsv1.UnregisterPushDeviceResponse, error) {
	userID, err := requireIdentity(ctx)
	if err != nil {
		return nil, err
	}
	id, err := ids.Parse(req.GetDeviceId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err.Error()).WithCause(err)
	}
	if err := h.service.UnregisterPushDevice(ctx, userID, id); err != nil {
		return nil, httpserver.ToConnectError(err)
	}
	return &notificationsv1.UnregisterPushDeviceResponse{}, nil
}

func (h *Handler) GetWebPushConfig(ctx context.Context, _ *notificationsv1.GetWebPushConfigRequest) (*notificationsv1.GetWebPushConfigResponse, error) {
	if _, err := requireIdentity(ctx); err != nil {
		return nil, err
	}
	return &notificationsv1.GetWebPushConfigResponse{VapidPublicKey: h.service.WebPushPublicKey()}, nil
}

func (h *Handler) GetPreferences(ctx context.Context, _ *notificationsv1.GetPreferencesRequest) (*notificationsv1.GetPreferencesResponse, error) {
	userID, err := requireIdentity(ctx)
	if err != nil {
		return nil, err
	}
	p, err := h.service.GetPreferences(ctx, userID)
	if err != nil {
		return nil, httpserver.ToConnectError(err)
	}
	return &notificationsv1.GetPreferencesResponse{Preferences: prefsToProto(p)}, nil
}

func (h *Handler) UpdatePreferences(ctx context.Context, req *notificationsv1.UpdatePreferencesRequest) (*notificationsv1.UpdatePreferencesResponse, error) {
	userID, err := requireIdentity(ctx)
	if err != nil {
		return nil, err
	}
	in := req.GetPreferences()
	p, err := h.service.UpdatePreferences(ctx, userID, api.Preferences{
		PushEnabled:   in.GetPushEnabled(),
		TaskCompleted: in.GetTaskCompleted(),
		TaskDueSoon:   in.GetTaskDueSoon(),
		MediaReady:    in.GetMediaReady(),
	})
	if err != nil {
		return nil, httpserver.ToConnectError(err)
	}
	return &notificationsv1.UpdatePreferencesResponse{Preferences: prefsToProto(p)}, nil
}

func requireIdentity(ctx context.Context) (ids.ID, error) {
	identity, ok := platformauth.FromContext(ctx)
	if !ok {
		return ids.Nil, httpserver.ToConnectError(sharederrors.Unauthorized("notifications", "missing identity"))
	}
	return identity.UserID, nil
}

func prefsToProto(p api.Preferences) *notificationsv1.Preferences {
	return &notificationsv1.Preferences{PushEnabled: p.PushEnabled, TaskCompleted: p.TaskCompleted, TaskDueSoon: p.TaskDueSoon, MediaReady: p.MediaReady}
}

func toProto(n api.Notification) *notificationsv1.Notification {
	out := &notificationsv1.Notification{
		Id:        n.ID.String(),
		Kind:      kindToProto(n.Kind),
		Title:     n.Title,
		Body:      n.Body,
		Link:      n.Link,
		CreatedAt: timestamppb.New(n.CreatedAt),
	}
	if n.SubjectID != nil {
		out.SubjectId = n.SubjectID.String()
	}
	if n.ReadAt != nil {
		out.ReadAt = timestamppb.New(*n.ReadAt)
	}
	return out
}

func kindToProto(k api.Kind) notificationsv1.NotificationKind {
	switch k {
	case api.KindTaskCompleted:
		return notificationsv1.NotificationKind_NOTIFICATION_KIND_TASK_COMPLETED
	case api.KindTaskDueSoon:
		return notificationsv1.NotificationKind_NOTIFICATION_KIND_TASK_DUE_SOON
	case api.KindMediaReady:
		return notificationsv1.NotificationKind_NOTIFICATION_KIND_MEDIA_READY
	case api.KindSystem:
		return notificationsv1.NotificationKind_NOTIFICATION_KIND_SYSTEM
	default:
		return notificationsv1.NotificationKind_NOTIFICATION_KIND_UNSPECIFIED
	}
}
