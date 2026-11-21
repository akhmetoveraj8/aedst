// Package transport implements the ConnectRPC handlers of the tasks module's
// completion feature (CompleteTask, ReopenTask). It depends only on the
// module's api and shared transport vocabulary (transport/taskproto);
// tasks/module joins it with the core feature's handler into the one
// TasksService handler.
package transport

import (
	"context"

	tasksv1 "github.com/aedst/server/gen/go/aedst/tasks/v1"
	"github.com/aedst/server/internal/modules/tasks/api"
	"github.com/aedst/server/internal/modules/tasks/transport/taskproto"
	"github.com/aedst/server/internal/platform/httpserver"
	"github.com/aedst/server/internal/shared/ids"
)

// Service is the part of api.Service this feature serves. Both methods are
// idempotent.
type Service interface {
	CompleteTask(ctx context.Context, userID, id ids.ID) (api.Task, error)
	ReopenTask(ctx context.Context, userID, id ids.ID) (api.Task, error)
}

type Handler struct {
	service Service
}

func NewHandler(service Service) *Handler {
	return &Handler{service: service}
}

func (h *Handler) CompleteTask(ctx context.Context, req *tasksv1.CompleteTaskRequest) (*tasksv1.CompleteTaskResponse, error) {
	userID, err := taskproto.RequireIdentity(ctx)
	if err != nil {
		return nil, err
	}
	id, err := taskproto.ParseID(req.GetId())
	if err != nil {
		return nil, err
	}

	task, svcErr := h.service.CompleteTask(ctx, userID, id)
	if svcErr != nil {
		return nil, httpserver.ToConnectError(svcErr)
	}
	return &tasksv1.CompleteTaskResponse{Task: taskproto.Task(task)}, nil
}

func (h *Handler) ReopenTask(ctx context.Context, req *tasksv1.ReopenTaskRequest) (*tasksv1.ReopenTaskResponse, error) {
	userID, err := taskproto.RequireIdentity(ctx)
	if err != nil {
		return nil, err
	}
	id, err := taskproto.ParseID(req.GetId())
	if err != nil {
		return nil, err
	}

	task, svcErr := h.service.ReopenTask(ctx, userID, id)
	if svcErr != nil {
		return nil, httpserver.ToConnectError(svcErr)
	}
	return &tasksv1.ReopenTaskResponse{Task: taskproto.Task(task)}, nil
}
