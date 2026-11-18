// Package remote holds admin's network clients of the modules it composes, used
// when such a module is not hosted in this process (AEDST_MODULE_<NAME>_URL). They
// implement the owners' own api interfaces, so admin's application layer is the
// same whether a module is local or not.
//
// Two kinds of call, two identities:
//   - reads (ListAllTasks, Stats, ...) happen inside an operator's request and
//     forward that operator's bearer token (modulekit.NewClient), so the owner
//     applies its own role policy to the same person;
//   - mutations run in the admin.apply job, which has no request and no token: they
//     use a TokenSource (a service identity with the "internal" role). Without one
//     a mutation is refused up front (Available), never queued.
package remote

import (
	"context"

	"github.com/jackc/pgx/v5"

	tasksv1 "github.com/aedst/server/gen/go/aedst/tasks/v1"
	tasksv1connect "github.com/aedst/server/gen/go/aedst/tasks/v1/tasksv1connect"
	tasksapi "github.com/aedst/server/internal/modules/tasks/api"
	platformauth "github.com/aedst/server/internal/platform/auth"
	"github.com/aedst/server/internal/platform/modulekit"
	sharederrors "github.com/aedst/server/internal/shared/errors"
	"github.com/aedst/server/internal/shared/ids"
	"github.com/aedst/server/internal/shared/pagination"
)

// TokenSource returns a bearer token for a call that has no operator behind it.
type TokenSource func(ctx context.Context) (string, error)

// asService runs a mutation under the service identity.
func asService(ctx context.Context, token TokenSource) (context.Context, error) {
	if token == nil {
		return ctx, errNoIdentity()
	}
	t, err := token(ctx)
	if err != nil {
		return ctx, sharederrors.Wrap("admin.remote", err)
	}
	return platformauth.WithBearer(ctx, t), nil
}

func errNoIdentity() error {
	return sharederrors.FailedPrecondition("admin.remote",
		"operator actions on a module that runs elsewhere need a service identity, which is not configured")
}

// Tasks is the tasks module reached over TasksOperatorService.
type Tasks struct {
	client tasksv1connect.TasksOperatorServiceClient
	token  TokenSource
}

var (
	_ tasksapi.AdminService    = (*Tasks)(nil)
	_ tasksapi.OperatorService = (*Tasks)(nil)
)

// NewTasks builds the client of the tasks module at target. token may be nil.
func NewTasks(target modulekit.RemoteTarget, token TokenSource) *Tasks {
	return &Tasks{client: tasksv1connect.NewTasksOperatorServiceClient(modulekit.NewClient(target)), token: token}
}

// Available reports whether mutations can run (a service identity exists).
func (t *Tasks) Available() error {
	if t.token == nil {
		return errNoIdentity()
	}
	return nil
}

func (t *Tasks) ListAllTasks(ctx context.Context, ownerID *ids.ID, search string, limit int32, after *pagination.Cursor) (tasksapi.ListResult, error) {
	req := &tasksv1.ListAllTasksRequest{Query: search, PageSize: limit}
	if ownerID != nil {
		req.OwnerId = ownerID.String()
	}
	if after != nil {
		req.PageToken = after.Encode()
	}
	res, err := t.client.ListAllTasks(ctx, req)
	if err != nil {
		return tasksapi.ListResult{}, modulekit.ErrorFromConnect("admin.remote.ListAllTasks", err)
	}
	out := tasksapi.ListResult{Tasks: make([]tasksapi.Task, 0, len(res.GetTasks()))}
	for _, pt := range res.GetTasks() {
		task, err := taskFromProto(pt)
		if err != nil {
			return tasksapi.ListResult{}, err
		}
		out.Tasks = append(out.Tasks, task)
	}
	if tok := res.GetNextPageToken(); tok != "" {
		if out.Next, err = pagination.Decode(tok, tasksapi.AdminSortToken); err != nil {
			return tasksapi.ListResult{}, sharederrors.Wrap("admin.remote.ListAllTasks", err)
		}
	}
	return out, nil
}

func (t *Tasks) Stats(ctx context.Context) (tasksapi.AdminStats, error) {
	res, err := t.client.GetAllTaskStats(ctx, &tasksv1.GetAllTaskStatsRequest{})
	if err != nil {
		return tasksapi.AdminStats{}, modulekit.ErrorFromConnect("admin.remote.Stats", err)
	}
	return tasksapi.AdminStats{Total: res.GetTotal(), Done: res.GetDone(), Overdue: res.GetOverdue()}, nil
}

// DeleteTaskTx cannot cross a process boundary: a transaction is not a value that
// can be sent. The service never calls it when the module is remote (it takes the
// audit-first path through DeleteTask).
func (t *Tasks) DeleteTaskTx(context.Context, pgx.Tx, ids.ID) (ids.ID, error) {
	return ids.Nil, sharederrors.FailedPrecondition("admin.remote.DeleteTaskTx", "a transaction cannot span processes: use the audit-first path")
}

// CountByOwners is not part of the network surface: no operator screen needs it
// across processes yet.
func (t *Tasks) CountByOwners(context.Context, []ids.ID) (map[ids.ID]int64, error) {
	return nil, sharederrors.FailedPrecondition("admin.remote.CountByOwners", "not available over the network")
}

// DeleteTask is the audit-first mutation: idempotent on key (the audit entry id).
func (t *Tasks) DeleteTask(ctx context.Context, key string, id ids.ID) (ids.ID, error) {
	ctx, err := asService(ctx, t.token)
	if err != nil {
		return ids.Nil, err
	}
	res, err := t.client.OperatorDeleteTask(ctx, &tasksv1.OperatorDeleteTaskRequest{TaskId: id.String(), IdempotencyKey: key})
	if err != nil {
		return ids.Nil, modulekit.ErrorFromConnect("admin.remote.DeleteTask", err)
	}
	owner, err := ids.Parse(res.GetOwnerId())
	if err != nil {
		return ids.Nil, sharederrors.Wrap("admin.remote.DeleteTask", err)
	}
	return owner, nil
}

func taskFromProto(p *tasksv1.Task) (tasksapi.Task, error) {
	id, err := ids.Parse(p.GetId())
	if err != nil {
		return tasksapi.Task{}, sharederrors.Wrap("admin.remote.task", err)
	}
	owner, err := ids.Parse(p.GetCreatedBy())
	if err != nil {
		return tasksapi.Task{}, sharederrors.Wrap("admin.remote.task", err)
	}
	t := tasksapi.Task{
		ID: id, UserID: owner, Title: p.GetTitle(), Description: p.GetDescription(),
		Status: statusFromProto(p.GetStatus()), Priority: priorityFromProto(p.GetPriority()),
		CreatedAt: p.GetCreatedAt().AsTime(), UpdatedAt: p.GetUpdatedAt().AsTime(), Version: int(p.GetVersion()),
	}
	if p.GetDueDate() != nil {
		d := p.GetDueDate().AsTime()
		t.DueDate = &d
	}
	if p.GetCompletedAt() != nil {
		c := p.GetCompletedAt().AsTime()
		t.CompletedAt = &c
	}
	return t, nil
}

func statusFromProto(s tasksv1.TaskStatus) tasksapi.Status {
	switch s {
	case tasksv1.TaskStatus_TASK_STATUS_TODO:
		return tasksapi.StatusTodo
	case tasksv1.TaskStatus_TASK_STATUS_IN_PROGRESS:
		return tasksapi.StatusInProgress
	case tasksv1.TaskStatus_TASK_STATUS_DONE:
		return tasksapi.StatusDone
	default:
		return ""
	}
}

func priorityFromProto(p tasksv1.TaskPriority) tasksapi.Priority {
	switch p {
	case tasksv1.TaskPriority_TASK_PRIORITY_LOW:
		return tasksapi.PriorityLow
	case tasksv1.TaskPriority_TASK_PRIORITY_MEDIUM:
		return tasksapi.PriorityMedium
	case tasksv1.TaskPriority_TASK_PRIORITY_HIGH:
		return tasksapi.PriorityHigh
	case tasksv1.TaskPriority_TASK_PRIORITY_URGENT:
		return tasksapi.PriorityUrgent
	default:
		return ""
	}
}
