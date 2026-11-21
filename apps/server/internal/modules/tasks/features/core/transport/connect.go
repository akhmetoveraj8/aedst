// Package transport implements the ConnectRPC handlers of the tasks module's
// core feature (create, read, list, edit, delete, counts). It depends only on
// the module's api and shared transport vocabulary (transport/taskproto), never
// on application/domain/infrastructure (see docs/content/server/modules.md).
// It never reads a user id from a request; every handler derives it from
// platform/auth.FromContext. tasks/module joins it with the completion
// feature's handler into the one TasksService handler.
package transport

import (
	"context"
	"time"

	"connectrpc.com/connect/v2"

	tasksv1 "github.com/aedst/server/gen/go/aedst/tasks/v1"
	"github.com/aedst/server/internal/modules/tasks/api"
	"github.com/aedst/server/internal/modules/tasks/transport/taskproto"
	"github.com/aedst/server/internal/platform/httpserver"
	"github.com/aedst/server/internal/platform/idempotency"
	"github.com/aedst/server/internal/shared/ids"
	"github.com/aedst/server/internal/shared/pagination"
)

// Service is the part of api.Service this feature serves.
type Service interface {
	CreateTask(ctx context.Context, userID ids.ID, title, description string, priority api.Priority, dueDate *time.Time, idempotencyKey string) (api.Task, error)
	GetTask(ctx context.Context, userID, id ids.ID) (api.Task, error)
	ListTasks(ctx context.Context, params api.ListParams) (api.ListResult, error)
	UpdateTask(ctx context.Context, userID, id ids.ID, patch api.Patch, expectedVersion *int, idempotencyKey string) (api.Task, error)
	DeleteTask(ctx context.Context, userID, id ids.ID, idempotencyKey string) error
	GetStats(ctx context.Context, userID ids.ID) (api.Stats, error)
}

type Handler struct {
	service Service
}

func NewHandler(service Service) *Handler {
	return &Handler{service: service}
}

func (h *Handler) CreateTask(ctx context.Context, req *tasksv1.CreateTaskRequest) (*tasksv1.CreateTaskResponse, error) {
	userID, err := taskproto.RequireIdentity(ctx)
	if err != nil {
		return nil, err
	}

	key, _ := idempotency.KeyFromContext(ctx)
	task, svcErr := h.service.CreateTask(ctx, userID,
		req.GetTitle(), req.GetDescription(),
		taskproto.PriorityFromProto(req.GetPriority()), taskproto.TimeFromProto(req.GetDueDate()), key)
	if svcErr != nil {
		return nil, httpserver.ToConnectError(svcErr)
	}
	return &tasksv1.CreateTaskResponse{Task: taskproto.Task(task)}, nil
}

func (h *Handler) GetTask(ctx context.Context, req *tasksv1.GetTaskRequest) (*tasksv1.GetTaskResponse, error) {
	userID, err := taskproto.RequireIdentity(ctx)
	if err != nil {
		return nil, err
	}
	id, err := ids.Parse(req.GetId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err.Error()).WithCause(err)
	}

	task, svcErr := h.service.GetTask(ctx, userID, id)
	if svcErr != nil {
		return nil, httpserver.ToConnectError(svcErr)
	}
	return &tasksv1.GetTaskResponse{Task: taskproto.Task(task)}, nil
}

func (h *Handler) ListTasks(ctx context.Context, req *tasksv1.ListTasksRequest) (*tasksv1.ListTasksResponse, error) {
	userID, err := taskproto.RequireIdentity(ctx)
	if err != nil {
		return nil, err
	}

	statuses := make([]api.Status, 0, len(req.GetStatuses()))
	for _, s := range req.GetStatuses() {
		statuses = append(statuses, taskproto.StatusFromProto(s))
	}
	priorities := make([]api.Priority, 0, len(req.GetPriorities()))
	for _, p := range req.GetPriorities() {
		priorities = append(priorities, taskproto.PriorityFromProto(p))
	}

	params := api.ListParams{
		UserID:        userID,
		Statuses:      statuses,
		Priorities:    priorities,
		Search:        req.GetSearch(),
		SortBy:        fromProtoSortField(req.GetSortBy()),
		SortDirection: fromProtoSortDirection(req.GetSortDirection()),
		Limit:         int(req.GetPageSize()),
	}
	// Normalize first: the cursor is bound to the effective ordering.
	if err := params.Normalize(); err != nil {
		return nil, httpserver.ToConnectError(err)
	}
	after, decodeErr := pagination.Decode(req.GetPageToken(), params.SortToken())
	if decodeErr != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, "invalid page_token")
	}
	params.After = after

	result, svcErr := h.service.ListTasks(ctx, params)
	if svcErr != nil {
		return nil, httpserver.ToConnectError(svcErr)
	}

	resp := &tasksv1.ListTasksResponse{
		Tasks:      make([]*tasksv1.Task, 0, len(result.Tasks)),
		TotalCount: int32(result.Total),
	}
	for _, t := range result.Tasks {
		resp.Tasks = append(resp.Tasks, taskproto.Task(t))
	}
	if result.Next != nil {
		resp.NextPageToken = result.Next.Encode()
	}
	return resp, nil
}

func (h *Handler) UpdateTask(ctx context.Context, req *tasksv1.UpdateTaskRequest) (*tasksv1.UpdateTaskResponse, error) {
	userID, err := taskproto.RequireIdentity(ctx)
	if err != nil {
		return nil, err
	}
	id, err := ids.Parse(req.GetId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err.Error()).WithCause(err)
	}
	patch, err := buildPatch(req)
	if err != nil {
		return nil, err
	}
	var expectedVersion *int
	if req.ExpectedVersion != nil {
		v := int(req.GetExpectedVersion())
		expectedVersion = &v
	}

	task, svcErr := h.service.UpdateTask(ctx, userID, id, patch, expectedVersion, idempotencyKeyOf(ctx))
	if svcErr != nil {
		return nil, httpserver.ToConnectError(svcErr)
	}
	return &tasksv1.UpdateTaskResponse{Task: taskproto.Task(task)}, nil
}

// buildPatch turns the request into a partial update. With no update_mask the
// request carries the whole form (the common "save" button) and every editable
// field applies; with one, only the named fields do, which is how a client
// clears due_date without resending the rest. Unknown mask paths are rejected
// instead of silently ignored, so a typo cannot look like a successful save.
func buildPatch(req *tasksv1.UpdateTaskRequest) (api.Patch, error) {
	paths := req.GetUpdateMask().GetPaths()
	if len(paths) == 0 {
		paths = []string{"title", "description", "priority", "due_date"}
	}
	var patch api.Patch
	for _, path := range paths {
		switch path {
		case "title":
			title := req.GetTitle()
			patch.Title = &title
		case "description":
			description := req.GetDescription()
			patch.Description = &description
		case "priority":
			priority := taskproto.PriorityFromProto(req.GetPriority())
			patch.Priority = &priority
		case "due_date":
			patch.SetDueDate = true
			patch.DueDate = taskproto.TimeFromProto(req.GetDueDate())
		default:
			return api.Patch{}, connect.Errorf(connect.CodeInvalidArgument, "update_mask: unsupported path %q", path)
		}
	}
	return patch, nil
}

func (h *Handler) DeleteTask(ctx context.Context, req *tasksv1.DeleteTaskRequest) (*tasksv1.DeleteTaskResponse, error) {
	userID, err := taskproto.RequireIdentity(ctx)
	if err != nil {
		return nil, err
	}
	id, err := ids.Parse(req.GetId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err.Error()).WithCause(err)
	}

	if svcErr := h.service.DeleteTask(ctx, userID, id, idempotencyKeyOf(ctx)); svcErr != nil {
		return nil, httpserver.ToConnectError(svcErr)
	}
	return &tasksv1.DeleteTaskResponse{}, nil
}

func (h *Handler) GetTaskStats(ctx context.Context, _ *tasksv1.GetTaskStatsRequest) (*tasksv1.GetTaskStatsResponse, error) {
	userID, err := taskproto.RequireIdentity(ctx)
	if err != nil {
		return nil, err
	}

	stats, svcErr := h.service.GetStats(ctx, userID)
	if svcErr != nil {
		return nil, httpserver.ToConnectError(svcErr)
	}
	return &tasksv1.GetTaskStatsResponse{
		Total:      int32(stats.Total),
		Todo:       int32(stats.Todo),
		InProgress: int32(stats.InProgress),
		Done:       int32(stats.Done),
		Overdue:    int32(stats.Overdue),
	}, nil
}

func fromProtoSortField(f tasksv1.TaskSortField) string {
	if f == tasksv1.TaskSortField_TASK_SORT_FIELD_DUE_DATE {
		return "due_date"
	}
	return "created_at"
}

func fromProtoSortDirection(d tasksv1.SortDirection) string {
	if d == tasksv1.SortDirection_SORT_DIRECTION_ASC {
		return "asc"
	}
	return "desc"
}

// idempotencyKeyOf is the request's Idempotency-Key header ("" when absent).
func idempotencyKeyOf(ctx context.Context) string {
	key, _ := idempotency.KeyFromContext(ctx)
	return key
}
