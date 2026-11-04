// Package transport implements the tasks module's ConnectRPC handlers. It
// depends only on modules/tasks/api — never on application/domain/
// infrastructure directly (see docs/content/server/modules.md). It never reads a user id
// from a request; every handler derives it from platform/auth.FromContext.
package transport

import (
	"context"
	"time"

	"connectrpc.com/connect/v2"
	"google.golang.org/protobuf/types/known/timestamppb"

	tasksv1 "github.com/aedst/server/gen/go/aedst/tasks/v1"
	platformauth "github.com/aedst/server/internal/platform/auth"
	"github.com/aedst/server/internal/platform/httpserver"
	"github.com/aedst/server/internal/platform/idempotency"
	sharederrors "github.com/aedst/server/internal/shared/errors"
	"github.com/aedst/server/internal/shared/ids"
	"github.com/aedst/server/internal/shared/pagination"

	"github.com/aedst/server/internal/modules/tasks/api"
)

type Handler struct {
	service api.Service
}

func NewHandler(service api.Service) *Handler {
	return &Handler{service: service}
}

func (h *Handler) CreateTask(ctx context.Context, req *tasksv1.CreateTaskRequest) (*tasksv1.CreateTaskResponse, error) {
	userID, err := requireIdentity(ctx)
	if err != nil {
		return nil, err
	}

	key, _ := idempotency.KeyFromContext(ctx)
	task, svcErr := h.service.CreateTask(ctx, userID,
		req.GetTitle(), req.GetDescription(),
		fromProtoPriority(req.GetPriority()), fromProtoTimestamp(req.GetDueDate()), key)
	if svcErr != nil {
		return nil, httpserver.ToConnectError(svcErr)
	}
	return &tasksv1.CreateTaskResponse{Task: toProtoTask(task)}, nil
}

func (h *Handler) GetTask(ctx context.Context, req *tasksv1.GetTaskRequest) (*tasksv1.GetTaskResponse, error) {
	userID, err := requireIdentity(ctx)
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
	return &tasksv1.GetTaskResponse{Task: toProtoTask(task)}, nil
}

func (h *Handler) ListTasks(ctx context.Context, req *tasksv1.ListTasksRequest) (*tasksv1.ListTasksResponse, error) {
	userID, err := requireIdentity(ctx)
	if err != nil {
		return nil, err
	}

	statuses := make([]api.Status, 0, len(req.GetStatuses()))
	for _, s := range req.GetStatuses() {
		statuses = append(statuses, fromProtoStatus(s))
	}
	priorities := make([]api.Priority, 0, len(req.GetPriorities()))
	for _, p := range req.GetPriorities() {
		priorities = append(priorities, fromProtoPriority(p))
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
		resp.Tasks = append(resp.Tasks, toProtoTask(t))
	}
	if result.Next != nil {
		resp.NextPageToken = result.Next.Encode()
	}
	return resp, nil
}

func (h *Handler) UpdateTask(ctx context.Context, req *tasksv1.UpdateTaskRequest) (*tasksv1.UpdateTaskResponse, error) {
	userID, err := requireIdentity(ctx)
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
	return &tasksv1.UpdateTaskResponse{Task: toProtoTask(task)}, nil
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
			priority := fromProtoPriority(req.GetPriority())
			patch.Priority = &priority
		case "due_date":
			patch.SetDueDate = true
			patch.DueDate = fromProtoTimestamp(req.GetDueDate())
		default:
			return api.Patch{}, connect.Errorf(connect.CodeInvalidArgument, "update_mask: unsupported path %q", path)
		}
	}
	return patch, nil
}

func (h *Handler) DeleteTask(ctx context.Context, req *tasksv1.DeleteTaskRequest) (*tasksv1.DeleteTaskResponse, error) {
	userID, err := requireIdentity(ctx)
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

func (h *Handler) CompleteTask(ctx context.Context, req *tasksv1.CompleteTaskRequest) (*tasksv1.CompleteTaskResponse, error) {
	userID, err := requireIdentity(ctx)
	if err != nil {
		return nil, err
	}
	id, err := ids.Parse(req.GetId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err.Error()).WithCause(err)
	}

	task, svcErr := h.service.CompleteTask(ctx, userID, id)
	if svcErr != nil {
		return nil, httpserver.ToConnectError(svcErr)
	}
	return &tasksv1.CompleteTaskResponse{Task: toProtoTask(task)}, nil
}

func (h *Handler) ReopenTask(ctx context.Context, req *tasksv1.ReopenTaskRequest) (*tasksv1.ReopenTaskResponse, error) {
	userID, err := requireIdentity(ctx)
	if err != nil {
		return nil, err
	}
	id, err := ids.Parse(req.GetId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err.Error()).WithCause(err)
	}

	task, svcErr := h.service.ReopenTask(ctx, userID, id)
	if svcErr != nil {
		return nil, httpserver.ToConnectError(svcErr)
	}
	return &tasksv1.ReopenTaskResponse{Task: toProtoTask(task)}, nil
}

func (h *Handler) GetTaskStats(ctx context.Context, _ *tasksv1.GetTaskStatsRequest) (*tasksv1.GetTaskStatsResponse, error) {
	userID, err := requireIdentity(ctx)
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

func requireIdentity(ctx context.Context) (ids.ID, error) {
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

func toProtoTask(t api.Task) *tasksv1.Task {
	return &tasksv1.Task{
		Id:          t.ID.String(),
		Title:       t.Title,
		Description: t.Description,
		Status:      toProtoStatus(t.Status),
		Priority:    toProtoPriority(t.Priority),
		DueDate:     toProtoTimestamp(t.DueDate),
		CreatedAt:   timestamppb.New(t.CreatedAt),
		UpdatedAt:   timestamppb.New(t.UpdatedAt),
		CompletedAt: toProtoTimestamp(t.CompletedAt),
		CreatedBy:   t.UserID.String(),
		Version:     int32(t.Version),
	}
}

func toProtoStatus(s api.Status) tasksv1.TaskStatus {
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

func fromProtoStatus(s tasksv1.TaskStatus) api.Status {
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

func toProtoPriority(p api.Priority) tasksv1.TaskPriority {
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

func fromProtoPriority(p tasksv1.TaskPriority) api.Priority {
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

func toProtoTimestamp(t *time.Time) *timestamppb.Timestamp {
	if t == nil {
		return nil
	}
	return timestamppb.New(*t)
}

func fromProtoTimestamp(t *timestamppb.Timestamp) *time.Time {
	if t == nil {
		return nil
	}
	tt := t.AsTime()
	return &tt
}

// idempotencyKeyOf is the request's Idempotency-Key header ("" when absent).
func idempotencyKeyOf(ctx context.Context) string {
	key, _ := idempotency.KeyFromContext(ctx)
	return key
}
