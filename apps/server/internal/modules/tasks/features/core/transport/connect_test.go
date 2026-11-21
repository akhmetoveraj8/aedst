package transport_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/aedst/server/internal/platform/idempotency"

	"connectrpc.com/connect/v2"
	"google.golang.org/protobuf/types/known/fieldmaskpb"
	"google.golang.org/protobuf/types/known/timestamppb"

	tasksv1 "github.com/aedst/server/gen/go/aedst/tasks/v1"
	"github.com/aedst/server/internal/modules/tasks/api"
	"github.com/aedst/server/internal/modules/tasks/features/core/transport"
	platformauth "github.com/aedst/server/internal/platform/auth"
	sharederrors "github.com/aedst/server/internal/shared/errors"
	"github.com/aedst/server/internal/shared/ids"
)

// fakeService records what the handler passed down and returns canned results.
type fakeService struct {
	api.Service // unimplemented methods panic: a test touching one is wrong

	user            ids.ID
	patch           api.Patch
	expectedVersion *int
	createKey       string
	updateKey       string
	deleteKey       string
	err             error
	task            api.Task
}

func (f *fakeService) CreateTask(_ context.Context, userID ids.ID, title, _ string, _ api.Priority, _ *time.Time, key string) (api.Task, error) {
	f.user, f.createKey = userID, key
	return api.Task{ID: ids.New(), UserID: userID, Title: title, Version: 1}, f.err
}

func (f *fakeService) UpdateTask(_ context.Context, userID, _ ids.ID, patch api.Patch, expected *int, key string) (api.Task, error) {
	f.user, f.patch, f.expectedVersion, f.updateKey = userID, patch, expected, key
	return f.task, f.err
}

func authed(user ids.ID) context.Context {
	return platformauth.WithIdentity(context.Background(), platformauth.Identity{UserID: user})
}

func TestUpdateTask_MaskSelectsWhatIsApplied(t *testing.T) {
	user, taskID := ids.New(), ids.New()
	due := timestamppb.New(time.Now().Add(time.Hour))

	tests := []struct {
		name  string
		req   *tasksv1.UpdateTaskRequest
		check func(t *testing.T, p api.Patch)
	}{
		{
			name: "no mask applies the whole form",
			req:  &tasksv1.UpdateTaskRequest{Id: taskID.String(), Title: "T", Description: "D", Priority: tasksv1.TaskPriority_TASK_PRIORITY_HIGH, DueDate: due},
			check: func(t *testing.T, p api.Patch) {
				if p.Title == nil || *p.Title != "T" || p.Description == nil || p.Priority == nil || *p.Priority != api.PriorityHigh || !p.SetDueDate || p.DueDate == nil {
					t.Errorf("patch = %+v, want every field set", p)
				}
			},
		},
		{
			name: "mask limits the change to due_date and lets it be cleared",
			req:  &tasksv1.UpdateTaskRequest{Id: taskID.String(), UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"due_date"}}},
			check: func(t *testing.T, p api.Patch) {
				if p.Title != nil || p.Description != nil || p.Priority != nil || !p.SetDueDate || p.DueDate != nil {
					t.Errorf("patch = %+v, want only a cleared due date", p)
				}
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			svc := &fakeService{}
			if _, err := transport.NewHandler(svc).UpdateTask(authed(user), tt.req); err != nil {
				t.Fatalf("UpdateTask: %v", err)
			}
			if svc.user != user {
				t.Errorf("service saw user %s, want the authenticated %s", svc.user, user)
			}
			tt.check(t, svc.patch)
		})
	}
}

func TestUpdateTask_RejectsUnknownMaskPathAndPassesExpectedVersion(t *testing.T) {
	user, taskID := ids.New(), ids.New()
	svc := &fakeService{}
	handler := transport.NewHandler(svc)

	_, err := handler.UpdateTask(authed(user), &tasksv1.UpdateTaskRequest{
		Id: taskID.String(), UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"titel"}},
	})
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("typo in update_mask: err = %v, want InvalidArgument (not a silent no-op)", err)
	}

	version := int32(7)
	if _, err := handler.UpdateTask(authed(user), &tasksv1.UpdateTaskRequest{Id: taskID.String(), Title: "x", ExpectedVersion: &version}); err != nil {
		t.Fatalf("UpdateTask: %v", err)
	}
	if svc.expectedVersion == nil || *svc.expectedVersion != 7 {
		t.Fatalf("expected version = %v, want 7", svc.expectedVersion)
	}
	if _, err := handler.UpdateTask(authed(user), &tasksv1.UpdateTaskRequest{Id: taskID.String(), Title: "x"}); err != nil || svc.expectedVersion != nil {
		t.Fatalf("without expected_version the update must be unconditional, got %v (err %v)", svc.expectedVersion, err)
	}
}

func TestHandlers_MapDomainErrorsAndRequireIdentity(t *testing.T) {
	user, taskID := ids.New(), ids.New()
	svc := &fakeService{}
	handler := transport.NewHandler(svc)

	svc.err = sharederrors.Conflict("tasks.Update", "task was modified by someone else")
	_, err := handler.UpdateTask(authed(user), &tasksv1.UpdateTaskRequest{Id: taskID.String(), Title: "x"})
	if connect.CodeOf(err) != connect.CodeAborted {
		t.Errorf("version conflict = %v, want Aborted (the client should re-read and retry)", err)
	}

	svc.err = sharederrors.Wrap("tasks.Update", errors.New("secret detail"))
	if _, err := handler.UpdateTask(authed(user), &tasksv1.UpdateTaskRequest{Id: taskID.String(), Title: "x"}); connect.CodeOf(err) != connect.CodeInternal || err.Error() != "internal: internal error" {
		t.Errorf("infrastructure failure = %v, want an opaque Internal", err)
	}

	svc.err = nil
	if _, err := handler.UpdateTask(context.Background(), &tasksv1.UpdateTaskRequest{Id: taskID.String(), Title: "x"}); connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Errorf("no identity on the context = %v, want Unauthenticated", err)
	}
	if _, err := handler.UpdateTask(authed(user), &tasksv1.UpdateTaskRequest{Id: "not-a-uuid", Title: "x"}); connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Errorf("malformed id = %v, want InvalidArgument", err)
	}
}

func TestCreateTask_PassesTheIdempotencyKeyAndOwner(t *testing.T) {
	user := ids.New()
	svc := &fakeService{}
	resp, err := transport.NewHandler(svc).CreateTask(authed(user), &tasksv1.CreateTaskRequest{Title: "x", Priority: tasksv1.TaskPriority_TASK_PRIORITY_LOW})
	if err != nil {
		t.Fatalf("CreateTask: %v", err)
	}
	if svc.user != user || resp.GetTask().GetCreatedBy() != user.String() || resp.GetTask().GetVersion() != 1 {
		t.Errorf("owner/version wrong: service user %s, response %+v", svc.user, resp.GetTask())
	}
}

func TestListTasks_RejectsForeignPageToken(t *testing.T) {
	_, err := transport.NewHandler(&fakeService{}).ListTasks(authed(ids.New()), &tasksv1.ListTasksRequest{PageToken: "garbage"})
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("garbage page_token = %v, want InvalidArgument", err)
	}
}

// statefulService covers the read/delete/state RPCs the tests above do not.
type statefulService struct {
	api.Service
	tasks  []api.Task
	stats  api.Stats
	err    error
	listed api.ListParams
}

func (s *statefulService) GetTask(context.Context, ids.ID, ids.ID) (api.Task, error) {
	return api.Task{ID: ids.New(), Title: "got", Status: api.StatusInProgress, Priority: api.PriorityUrgent}, s.err
}

func (s *statefulService) DeleteTask(context.Context, ids.ID, ids.ID, string) error { return s.err }

func (s *statefulService) GetStats(context.Context, ids.ID) (api.Stats, error) { return s.stats, s.err }

func (s *statefulService) ListTasks(_ context.Context, p api.ListParams) (api.ListResult, error) {
	s.listed = p
	return api.ListResult{Tasks: s.tasks, Total: len(s.tasks)}, s.err
}

func TestReadAndStateRPCs(t *testing.T) {
	user, taskID := ids.New(), ids.New()
	svc := &statefulService{
		stats: api.Stats{Total: 5, Todo: 2, InProgress: 1, Done: 2, Overdue: 1},
		tasks: []api.Task{{ID: ids.New(), Title: "a"}, {ID: ids.New(), Title: "b"}},
	}
	handler := transport.NewHandler(svc)
	ctx := authed(user)

	got, err := handler.GetTask(ctx, &tasksv1.GetTaskRequest{Id: taskID.String()})
	if err != nil || got.GetTask().GetStatus() != tasksv1.TaskStatus_TASK_STATUS_IN_PROGRESS || got.GetTask().GetPriority() != tasksv1.TaskPriority_TASK_PRIORITY_URGENT {
		t.Fatalf("GetTask = %+v, %v", got, err)
	}
	if _, err := handler.DeleteTask(ctx, &tasksv1.DeleteTaskRequest{Id: taskID.String()}); err != nil {
		t.Fatalf("DeleteTask: %v", err)
	}
	stats, err := handler.GetTaskStats(ctx, &tasksv1.GetTaskStatsRequest{})
	if err != nil || stats.GetTotal() != 5 || stats.GetOverdue() != 1 || stats.GetInProgress() != 1 {
		t.Fatalf("GetTaskStats = %+v, %v", stats, err)
	}

	list, err := handler.ListTasks(ctx, &tasksv1.ListTasksRequest{
		Statuses:      []tasksv1.TaskStatus{tasksv1.TaskStatus_TASK_STATUS_TODO, tasksv1.TaskStatus_TASK_STATUS_DONE},
		Priorities:    []tasksv1.TaskPriority{tasksv1.TaskPriority_TASK_PRIORITY_LOW},
		Search:        "milk",
		SortBy:        tasksv1.TaskSortField_TASK_SORT_FIELD_DUE_DATE,
		SortDirection: tasksv1.SortDirection_SORT_DIRECTION_ASC,
		PageSize:      10,
	})
	if err != nil || len(list.GetTasks()) != 2 || list.GetTotalCount() != 2 {
		t.Fatalf("ListTasks = %+v, %v", list, err)
	}
	p := svc.listed
	if p.UserID != user || len(p.Statuses) != 2 || p.Statuses[1] != api.StatusDone || p.Priorities[0] != api.PriorityLow ||
		p.Search != "milk" || p.SortBy != "due_date" || p.SortDirection != "asc" || p.Limit != 10 {
		t.Fatalf("filters not passed through: %+v", p)
	}

	svc.err = sharederrors.NotFound("tasks.Get", "task not found")
	for name, call := range map[string]func() error{
		"GetTask": func() error {
			_, err := handler.GetTask(ctx, &tasksv1.GetTaskRequest{Id: taskID.String()})
			return err
		},
		"DeleteTask": func() error {
			_, err := handler.DeleteTask(ctx, &tasksv1.DeleteTaskRequest{Id: taskID.String()})
			return err
		},
		"Stats": func() error {
			_, err := handler.GetTaskStats(ctx, &tasksv1.GetTaskStatsRequest{})
			return err
		},
		"List": func() error {
			_, err := handler.ListTasks(ctx, &tasksv1.ListTasksRequest{})
			return err
		},
	} {
		if connect.CodeOf(call()) != connect.CodeNotFound {
			t.Errorf("%s did not map the domain error", name)
		}
	}
	for name, call := range map[string]func() error{
		"GetTask": func() error {
			_, err := handler.GetTask(ctx, &tasksv1.GetTaskRequest{Id: "x"})
			return err
		},
		"DeleteTask": func() error {
			_, err := handler.DeleteTask(ctx, &tasksv1.DeleteTaskRequest{Id: "x"})
			return err
		},
	} {
		if connect.CodeOf(call()) != connect.CodeInvalidArgument {
			t.Errorf("%s accepted a malformed id", name)
		}
	}
}

func (f *fakeService) DeleteTask(_ context.Context, userID, _ ids.ID, key string) error {
	f.user, f.deleteKey = userID, key
	return f.err
}

// The Idempotency-Key header (put in the context by idempotency.HeaderInterceptor)
// reaches every write a client may queue offline and replay.
func TestWrites_PassTheIdempotencyKeyDown(t *testing.T) {
	user, taskID := ids.New(), ids.New()
	svc := &fakeService{task: api.Task{ID: taskID}}
	ctx := idempotency.WithKey(authed(user), "outbox-item-7")
	handler := transport.NewHandler(svc)

	if _, err := handler.UpdateTask(ctx, &tasksv1.UpdateTaskRequest{Id: taskID.String(), Title: "x"}); err != nil || svc.updateKey != "outbox-item-7" {
		t.Errorf("UpdateTask key = %q (%v), want outbox-item-7", svc.updateKey, err)
	}
	if _, err := handler.DeleteTask(ctx, &tasksv1.DeleteTaskRequest{Id: taskID.String()}); err != nil || svc.deleteKey != "outbox-item-7" {
		t.Errorf("DeleteTask key = %q (%v), want outbox-item-7", svc.deleteKey, err)
	}
	if _, err := handler.UpdateTask(authed(user), &tasksv1.UpdateTaskRequest{Id: taskID.String(), Title: "x"}); err != nil || svc.updateKey != "" {
		t.Errorf("UpdateTask without a header passed key %q", svc.updateKey)
	}
}
