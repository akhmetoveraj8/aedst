// Package taskproto is the tasks module's shared transport vocabulary: the
// mapping between the module's api types and the aedst.tasks.v1 messages, and
// the identity check every owner-scoped handler starts with. Every feature's
// transport imports it; like any transport package it depends only on the
// module's api (plus platform and shared), and it imports no feature.
package taskproto

import (
	"context"
	"time"

	"connectrpc.com/connect/v2"
	"google.golang.org/protobuf/types/known/timestamppb"

	tasksv1 "github.com/aedst/server/gen/go/aedst/tasks/v1"
	"github.com/aedst/server/internal/modules/tasks/api"
	platformauth "github.com/aedst/server/internal/platform/auth"
	"github.com/aedst/server/internal/platform/httpserver"
	sharederrors "github.com/aedst/server/internal/shared/errors"
	"github.com/aedst/server/internal/shared/ids"
)

// RequireIdentity returns the authenticated caller. No handler ever reads a
// user id from a request.
func RequireIdentity(ctx context.Context) (ids.ID, error) {
	identity, ok := platformauth.FromContext(ctx)
	if !ok {
		// Unreachable in practice: no tasks procedure is in
		// publicProcedures, so AuthInterceptor has already rejected any
		// request that reaches here without a verified identity. Guarded
		// anyway rather than trusting that wiring never changes.
		return ids.Nil, httpserver.ToConnectError(sharederrors.Unauthorized("tasks", "missing identity"))
	}
	return identity.UserID, nil
}

// ParseID parses a task id from a request, InvalidArgument when malformed.
func ParseID(raw string) (ids.ID, error) {
	id, err := ids.Parse(raw)
	if err != nil {
		return ids.Nil, connect.NewError(connect.CodeInvalidArgument, err.Error()).WithCause(err)
	}
	return id, nil
}

func Task(t api.Task) *tasksv1.Task {
	return &tasksv1.Task{
		Id:          t.ID.String(),
		Title:       t.Title,
		Description: t.Description,
		Status:      Status(t.Status),
		Priority:    Priority(t.Priority),
		DueDate:     Timestamp(t.DueDate),
		CreatedAt:   timestamppb.New(t.CreatedAt),
		UpdatedAt:   timestamppb.New(t.UpdatedAt),
		CompletedAt: Timestamp(t.CompletedAt),
		CreatedBy:   t.UserID.String(),
		Version:     int32(t.Version),
	}
}

func Status(s api.Status) tasksv1.TaskStatus {
	switch s {
	case api.StatusTodo:
		return tasksv1.TaskStatus_TASK_STATUS_TODO
	case api.StatusInProgress:
		return tasksv1.TaskStatus_TASK_STATUS_IN_PROGRESS
	case api.StatusDone:
		return tasksv1.TaskStatus_TASK_STATUS_DONE
	default:
		return tasksv1.TaskStatus_TASK_STATUS_UNSPECIFIED
	}
}

func StatusFromProto(s tasksv1.TaskStatus) api.Status {
	switch s {
	case tasksv1.TaskStatus_TASK_STATUS_TODO:
		return api.StatusTodo
	case tasksv1.TaskStatus_TASK_STATUS_IN_PROGRESS:
		return api.StatusInProgress
	case tasksv1.TaskStatus_TASK_STATUS_DONE:
		return api.StatusDone
	default:
		return ""
	}
}

func Priority(p api.Priority) tasksv1.TaskPriority {
	switch p {
	case api.PriorityLow:
		return tasksv1.TaskPriority_TASK_PRIORITY_LOW
	case api.PriorityMedium:
		return tasksv1.TaskPriority_TASK_PRIORITY_MEDIUM
	case api.PriorityHigh:
		return tasksv1.TaskPriority_TASK_PRIORITY_HIGH
	case api.PriorityUrgent:
		return tasksv1.TaskPriority_TASK_PRIORITY_URGENT
	default:
		return tasksv1.TaskPriority_TASK_PRIORITY_UNSPECIFIED
	}
}

func PriorityFromProto(p tasksv1.TaskPriority) api.Priority {
	switch p {
	case tasksv1.TaskPriority_TASK_PRIORITY_LOW:
		return api.PriorityLow
	case tasksv1.TaskPriority_TASK_PRIORITY_MEDIUM:
		return api.PriorityMedium
	case tasksv1.TaskPriority_TASK_PRIORITY_HIGH:
		return api.PriorityHigh
	case tasksv1.TaskPriority_TASK_PRIORITY_URGENT:
		return api.PriorityUrgent
	default:
		return ""
	}
}

func Timestamp(t *time.Time) *timestamppb.Timestamp {
	if t == nil {
		return nil
	}
	return timestamppb.New(*t)
}

func TimeFromProto(t *timestamppb.Timestamp) *time.Time {
	if t == nil {
		return nil
	}
	tt := t.AsTime()
	return &tt
}
