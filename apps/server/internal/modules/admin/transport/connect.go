// Package transport implements AdminService. It contains no authorization
// logic: AEDST_ROLE_POLICY (built-in default /aedst.admin.v1.AdminService/*=admin)
// is enforced by httpserver.RoleInterceptor.
package transport

import (
	"context"

	"connectrpc.com/connect/v2"
	"google.golang.org/protobuf/types/known/timestamppb"

	adminv1 "github.com/aedst/server/gen/go/aedst/admin/v1"
	"github.com/aedst/server/internal/modules/admin/api"
	platformauth "github.com/aedst/server/internal/platform/auth"
	"github.com/aedst/server/internal/platform/httpserver"
	sharederrors "github.com/aedst/server/internal/shared/errors"
	"github.com/aedst/server/internal/shared/ids"
)

type Handler struct {
	service api.Service
}

func NewHandler(service api.Service) *Handler { return &Handler{service: service} }

func (h *Handler) GetOverview(ctx context.Context, _ *adminv1.GetOverviewRequest) (*adminv1.GetOverviewResponse, error) {
	o, err := h.service.GetOverview(ctx)
	if err != nil {
		return nil, httpserver.ToConnectError(err)
	}
	return &adminv1.GetOverviewResponse{
		TasksTotal: o.TasksTotal, TasksDone: o.TasksDone, TasksOverdue: o.TasksOverdue,
		MediaTotal: o.MediaTotal, MediaBytes: o.MediaBytes, PushDevices: o.PushDevices,
		OutboxLagSeconds: o.JobLagSeconds, JobsPending: o.JobsPending,
	}, nil
}

func (h *Handler) ListTasks(ctx context.Context, req *adminv1.ListTasksRequest) (*adminv1.ListTasksResponse, error) {
	owner, err := optionalID(req.GetOwnerId())
	if err != nil {
		return nil, err
	}
	res, err := h.service.ListTasks(ctx, owner, req.GetQuery(), req.GetPageSize(), req.GetPageToken())
	if err != nil {
		return nil, httpserver.ToConnectError(err)
	}
	out := &adminv1.ListTasksResponse{Tasks: make([]*adminv1.AdminTask, 0, len(res.Tasks))}
	for _, t := range res.Tasks {
		at := &adminv1.AdminTask{Id: t.ID.String(), OwnerId: t.UserID.String(), Title: t.Title, Status: statusNumber(string(t.Status)), CreatedAt: timestamppb.New(t.CreatedAt)}
		if t.DueDate != nil {
			at.DueDate = timestamppb.New(*t.DueDate)
		}
		out.Tasks = append(out.Tasks, at)
	}
	if res.Next != nil {
		out.NextPageToken = res.Next.Encode()
	}
	return out, nil
}

// statusNumber maps to aedst.tasks.v1.TaskStatus numbers (admin.proto keeps
// it an int32 to avoid a cross-package proto import).
func statusNumber(s string) int32 {
	switch s {
	case "todo":
		return 1
	case "in_progress":
		return 2
	case "done":
		return 3
	default:
		return 0
	}
}

func (h *Handler) DeleteTask(ctx context.Context, req *adminv1.DeleteTaskRequest) (*adminv1.DeleteTaskResponse, error) {
	actor, err := actorOf(ctx)
	if err != nil {
		return nil, err
	}
	id, err := ids.Parse(req.GetId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, "id must be a UUID")
	}
	if err := h.service.DeleteTask(ctx, actor, id, req.GetReason()); err != nil {
		return nil, httpserver.ToConnectError(err)
	}
	return &adminv1.DeleteTaskResponse{}, nil
}

func (h *Handler) BroadcastNotification(ctx context.Context, req *adminv1.BroadcastNotificationRequest) (*adminv1.BroadcastNotificationResponse, error) {
	actor, err := actorOf(ctx)
	if err != nil {
		return nil, err
	}
	userID, err := optionalID(req.GetUserId())
	if err != nil {
		return nil, err
	}
	n, err := h.service.BroadcastNotification(ctx, actor, userID, req.GetTitle(), req.GetBody(), req.GetLink())
	if err != nil {
		return nil, httpserver.ToConnectError(err)
	}
	return &adminv1.BroadcastNotificationResponse{Recipients: n}, nil
}

func (h *Handler) ListAuditLog(ctx context.Context, req *adminv1.ListAuditLogRequest) (*adminv1.ListAuditLogResponse, error) {
	entries, next, err := h.service.ListAuditLog(ctx, req.GetPageSize(), req.GetPageToken())
	if err != nil {
		return nil, httpserver.ToConnectError(err)
	}
	out := &adminv1.ListAuditLogResponse{Entries: make([]*adminv1.AuditEntry, 0, len(entries))}
	for _, e := range entries {
		out.Entries = append(out.Entries, &adminv1.AuditEntry{
			Id: e.ID.String(), ActorId: e.Actor.UserID.String(), Action: e.Action,
			TargetKind: e.TargetKind, TargetId: e.TargetID, Reason: e.Reason, CreatedAt: timestamppb.New(e.CreatedAt),
		})
	}
	if next != nil {
		out.NextPageToken = next.Encode()
	}
	return out, nil
}

func actorOf(ctx context.Context) (api.Actor, error) {
	identity, ok := platformauth.FromContext(ctx)
	if !ok {
		return api.Actor{}, httpserver.ToConnectError(sharederrors.Unauthorized("admin", "missing identity"))
	}
	return api.Actor{UserID: identity.UserID, Subject: identity.Subject, Issuer: identity.Issuer}, nil
}

func optionalID(raw string) (*ids.ID, error) {
	if raw == "" {
		return nil, nil
	}
	id, err := ids.Parse(raw)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, "id must be a UUID")
	}
	return &id, nil
}
