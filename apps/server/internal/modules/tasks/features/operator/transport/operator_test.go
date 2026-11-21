package transport_test

import (
	"context"
	"testing"

	"connectrpc.com/connect/v2"

	tasksv1 "github.com/aedst/server/gen/go/aedst/tasks/v1"
	"github.com/aedst/server/internal/modules/tasks/api"
	"github.com/aedst/server/internal/modules/tasks/features/operator/transport"
	sharederrors "github.com/aedst/server/internal/shared/errors"
	"github.com/aedst/server/internal/shared/ids"
	"github.com/aedst/server/internal/shared/pagination"
)

type operatorAdmin struct {
	api.AdminService
	owner  *ids.ID
	after  *pagination.Cursor
	result api.ListResult
}

func (a *operatorAdmin) ListAllTasks(_ context.Context, owner *ids.ID, _ string, _ int32, after *pagination.Cursor) (api.ListResult, error) {
	a.owner, a.after = owner, after
	return a.result, nil
}

func (a *operatorAdmin) Stats(context.Context) (api.AdminStats, error) {
	return api.AdminStats{Total: 9, Done: 3, Overdue: 2}, nil
}

type operatorOps struct {
	key  string
	task ids.ID
	err  error
}

func (o *operatorOps) DeleteTask(_ context.Context, key string, id ids.ID) (ids.ID, error) {
	o.key, o.task = key, id
	return ids.Nil, o.err
}

func TestOperatorHandler_ListAllTasksPagesWithTheOwnersCursor(t *testing.T) {
	cursor := pagination.Cursor{Sort: api.AdminSortToken, ID: ids.New()}
	admin := &operatorAdmin{result: api.ListResult{Tasks: []api.Task{{ID: ids.New(), UserID: ids.New(), Title: "a"}}, Next: &cursor}}
	h := transport.NewOperatorHandler(admin, &operatorOps{})
	owner := ids.New()

	res, err := h.ListAllTasks(context.Background(), &tasksv1.ListAllTasksRequest{OwnerId: owner.String(), PageToken: cursor.Encode()})
	if err != nil {
		t.Fatal(err)
	}
	if admin.owner == nil || *admin.owner != owner || admin.after == nil || admin.after.ID != cursor.ID {
		t.Errorf("owner %v, after %v", admin.owner, admin.after)
	}
	if len(res.GetTasks()) != 1 || res.GetNextPageToken() != cursor.Encode() || res.GetTasks()[0].GetCreatedBy() == "" {
		t.Errorf("response = %+v", res)
	}

	// A token minted for another ordering is refused, like everywhere else.
	other := pagination.Cursor{Sort: "other:sort", ID: ids.New()}
	_, err = h.ListAllTasks(context.Background(), &tasksv1.ListAllTasksRequest{PageToken: other.Encode()})
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Errorf("foreign token: %v", err)
	}
}

func TestOperatorHandler_GetAllTaskStats(t *testing.T) {
	res, err := transport.NewOperatorHandler(&operatorAdmin{}, &operatorOps{}).GetAllTaskStats(context.Background(), &tasksv1.GetAllTaskStatsRequest{})
	if err != nil || res.GetTotal() != 9 || res.GetDone() != 3 || res.GetOverdue() != 2 {
		t.Fatalf("stats = %+v, %v", res, err)
	}
}

func TestOperatorHandler_DeleteTaskPassesTheKeyAndMapsErrors(t *testing.T) {
	ops := &operatorOps{}
	h := transport.NewOperatorHandler(&operatorAdmin{}, ops)
	task, owner := ids.New(), ids.New()

	ops.err = nil
	if _, err := h.OperatorDeleteTask(context.Background(), &tasksv1.OperatorDeleteTaskRequest{TaskId: task.String(), IdempotencyKey: "audit-1"}); err != nil {
		t.Fatal(err)
	}
	if ops.key != "audit-1" || ops.task != task {
		t.Errorf("ops saw key %q task %v", ops.key, ops.task)
	}
	_ = owner

	ops.err = sharederrors.NotFound("tasks", "task not found")
	if _, err := h.OperatorDeleteTask(context.Background(), &tasksv1.OperatorDeleteTaskRequest{TaskId: task.String(), IdempotencyKey: "audit-1"}); connect.CodeOf(err) != connect.CodeNotFound {
		t.Errorf("NotFound maps to %v", connect.CodeOf(err))
	}
	ops.err = sharederrors.Conflict("idempotency", "key reused")
	if _, err := h.OperatorDeleteTask(context.Background(), &tasksv1.OperatorDeleteTaskRequest{TaskId: task.String(), IdempotencyKey: "audit-1"}); connect.CodeOf(err) != connect.CodeAborted {
		t.Errorf("Conflict maps to %v", connect.CodeOf(err))
	}
	if _, err := h.OperatorDeleteTask(context.Background(), &tasksv1.OperatorDeleteTaskRequest{TaskId: "nope"}); connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Errorf("a malformed id maps to %v", connect.CodeOf(err))
	}
}
