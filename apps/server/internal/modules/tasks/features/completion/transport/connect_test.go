package transport_test

import (
	"context"
	"errors"
	"testing"

	"connectrpc.com/connect/v2"

	tasksv1 "github.com/aedst/server/gen/go/aedst/tasks/v1"
	"github.com/aedst/server/internal/modules/tasks/api"
	"github.com/aedst/server/internal/modules/tasks/features/completion/transport"
	platformauth "github.com/aedst/server/internal/platform/auth"
	sharederrors "github.com/aedst/server/internal/shared/errors"
	"github.com/aedst/server/internal/shared/ids"
)

// fakeService records the caller the handler passed down and returns canned results.
type fakeService struct {
	user ids.ID
	err  error
}

func (f *fakeService) CompleteTask(_ context.Context, userID, id ids.ID) (api.Task, error) {
	f.user = userID
	return api.Task{ID: id, UserID: userID, Status: api.StatusDone}, f.err
}

func (f *fakeService) ReopenTask(_ context.Context, userID, id ids.ID) (api.Task, error) {
	f.user = userID
	return api.Task{ID: id, UserID: userID, Status: api.StatusTodo}, f.err
}

func authed(user ids.ID) context.Context {
	return platformauth.WithIdentity(context.Background(), platformauth.Identity{UserID: user})
}

func TestHandlers_PassTheCallerAndMapTheTask(t *testing.T) {
	user, taskID := ids.New(), ids.New()
	svc := &fakeService{}
	handler := transport.NewHandler(svc)

	done, err := handler.CompleteTask(authed(user), &tasksv1.CompleteTaskRequest{Id: taskID.String()})
	if err != nil || done.GetTask().GetStatus() != tasksv1.TaskStatus_TASK_STATUS_DONE || done.GetTask().GetId() != taskID.String() || svc.user != user {
		t.Fatalf("CompleteTask = %+v, %v (service saw user %s)", done, err, svc.user)
	}
	reopened, err := handler.ReopenTask(authed(user), &tasksv1.ReopenTaskRequest{Id: taskID.String()})
	if err != nil || reopened.GetTask().GetStatus() != tasksv1.TaskStatus_TASK_STATUS_TODO {
		t.Fatalf("ReopenTask = %+v, %v", reopened, err)
	}
}

func TestHandlers_MapDomainErrorsAndRequireIdentity(t *testing.T) {
	user, taskID := ids.New(), ids.New()
	svc := &fakeService{}
	handler := transport.NewHandler(svc)
	calls := map[string]func(ctx context.Context, id string) error{
		"CompleteTask": func(ctx context.Context, id string) error {
			_, err := handler.CompleteTask(ctx, &tasksv1.CompleteTaskRequest{Id: id})
			return err
		},
		"ReopenTask": func(ctx context.Context, id string) error {
			_, err := handler.ReopenTask(ctx, &tasksv1.ReopenTaskRequest{Id: id})
			return err
		},
	}
	for name, call := range calls {
		svc.err = sharederrors.NotFound("tasks.Complete", "task not found")
		if err := call(authed(user), taskID.String()); connect.CodeOf(err) != connect.CodeNotFound {
			t.Errorf("%s: missing task = %v, want NotFound", name, err)
		}

		svc.err = sharederrors.Wrap("tasks.Complete", errors.New("secret detail"))
		if err := call(authed(user), taskID.String()); connect.CodeOf(err) != connect.CodeInternal || err.Error() != "internal: internal error" {
			t.Errorf("%s: infrastructure failure = %v, want an opaque Internal", name, err)
		}

		svc.err = nil
		if err := call(context.Background(), taskID.String()); connect.CodeOf(err) != connect.CodeUnauthenticated {
			t.Errorf("%s: no identity on the context = %v, want Unauthenticated", name, err)
		}
		if err := call(authed(user), "not-a-uuid"); connect.CodeOf(err) != connect.CodeInvalidArgument {
			t.Errorf("%s: malformed id = %v, want InvalidArgument", name, err)
		}
	}
}
