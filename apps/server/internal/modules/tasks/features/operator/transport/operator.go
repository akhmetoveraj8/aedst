// Package transport implements the ConnectRPC handler of the tasks module's
// operator feature (TasksOperatorService). Like every transport package it
// depends only on the module's api and shared transport vocabulary.
package transport

import (
	"context"

	"connectrpc.com/connect/v2"

	tasksv1 "github.com/aedst/server/gen/go/aedst/tasks/v1"
	"github.com/aedst/server/internal/modules/tasks/api"
	"github.com/aedst/server/internal/modules/tasks/transport/taskproto"
	"github.com/aedst/server/internal/platform/httpserver"
	sharederrors "github.com/aedst/server/internal/shared/errors"
	"github.com/aedst/server/internal/shared/ids"
	"github.com/aedst/server/internal/shared/pagination"
)

// OperatorHandler serves TasksOperatorService: the cross-owner surface the admin
// module reaches when tasks runs in another process. Who may call it is the role
// policy's business (module.operatorRoles), not this handler's.
type OperatorHandler struct {
	admin api.AdminService
	ops   api.OperatorService
}

// NewOperatorHandler builds the handler over the operator api.
func NewOperatorHandler(admin api.AdminService, ops api.OperatorService) *OperatorHandler {
	return &OperatorHandler{admin: admin, ops: ops}
}

func (h *OperatorHandler) ListAllTasks(ctx context.Context, req *tasksv1.ListAllTasksRequest) (*tasksv1.ListAllTasksResponse, error) {
	var owner *ids.ID
	if req.GetOwnerId() != "" {
		id, err := ids.Parse(req.GetOwnerId())
		if err != nil {
			return nil, connect.NewError(connect.CodeInvalidArgument, err.Error()).WithCause(err)
		}
		owner = &id
	}
	after, err := pagination.Decode(req.GetPageToken(), api.AdminSortToken)
	if err != nil {
		return nil, httpserver.ToConnectError(sharederrors.Validation("tasks.ListAllTasks", "invalid page token"))
	}
	res, err := h.admin.ListAllTasks(ctx, owner, req.GetQuery(), req.GetPageSize(), after)
	if err != nil {
		return nil, httpserver.ToConnectError(err)
	}
	out := &tasksv1.ListAllTasksResponse{Tasks: make([]*tasksv1.Task, len(res.Tasks))}
	for i, t := range res.Tasks {
		out.Tasks[i] = taskproto.Task(t)
	}
	if res.Next != nil {
		out.NextPageToken = res.Next.Encode()
	}
	return out, nil
}

func (h *OperatorHandler) GetAllTaskStats(ctx context.Context, _ *tasksv1.GetAllTaskStatsRequest) (*tasksv1.GetAllTaskStatsResponse, error) {
	s, err := h.admin.Stats(ctx)
	if err != nil {
		return nil, httpserver.ToConnectError(err)
	}
	return &tasksv1.GetAllTaskStatsResponse{Total: s.Total, Done: s.Done, Overdue: s.Overdue}, nil
}

func (h *OperatorHandler) OperatorDeleteTask(ctx context.Context, req *tasksv1.OperatorDeleteTaskRequest) (*tasksv1.OperatorDeleteTaskResponse, error) {
	id, err := ids.Parse(req.GetTaskId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err.Error()).WithCause(err)
	}
	owner, err := h.ops.DeleteTask(ctx, req.GetIdempotencyKey(), id)
	if err != nil {
		return nil, httpserver.ToConnectError(err)
	}
	return &tasksv1.OperatorDeleteTaskResponse{OwnerId: owner.String()}, nil
}
