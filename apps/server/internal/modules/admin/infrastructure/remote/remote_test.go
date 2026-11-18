package remote_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"google.golang.org/protobuf/types/known/timestamppb"

	notificationsv1 "github.com/aedst/server/gen/go/aedst/notifications/v1"
	notificationsv1connect "github.com/aedst/server/gen/go/aedst/notifications/v1/notificationsv1connect"
	tasksv1 "github.com/aedst/server/gen/go/aedst/tasks/v1"
	tasksv1connect "github.com/aedst/server/gen/go/aedst/tasks/v1/tasksv1connect"
	"github.com/aedst/server/internal/modules/admin/infrastructure/remote"
	notificationsapi "github.com/aedst/server/internal/modules/notifications/api"
	tasksapi "github.com/aedst/server/internal/modules/tasks/api"
	platformauth "github.com/aedst/server/internal/platform/auth"
	"github.com/aedst/server/internal/platform/modulekit"
	sharederrors "github.com/aedst/server/internal/shared/errors"
	"github.com/aedst/server/internal/shared/ids"
	"github.com/aedst/server/internal/shared/pagination"
)

// seen records what the owner received: the credential and the request.
type seen struct {
	authorization string
	deleteKey     string
	deleteTask    string
	listToken     string
	broadcast     *notificationsv1.OperatorBroadcastRequest
}

type tasksOwner struct {
	tasksv1connect.UnimplementedTasksOperatorServiceHandler
	seen  *seen
	owner ids.ID
	next  string
}

func (o *tasksOwner) ListAllTasks(ctx context.Context, req *tasksv1.ListAllTasksRequest) (*tasksv1.ListAllTasksResponse, error) {
	o.seen.listToken = req.GetPageToken()
	info, _ := connect.CallInfoForServerContext(ctx)
	o.seen.authorization = info.RequestHeader().Get("Authorization")
	due := time.Date(2030, 1, 2, 3, 4, 5, 0, time.UTC)
	return &tasksv1.ListAllTasksResponse{
		Tasks: []*tasksv1.Task{{
			Id: ids.New().String(), Title: "t", Status: tasksv1.TaskStatus_TASK_STATUS_DONE, Priority: tasksv1.TaskPriority_TASK_PRIORITY_HIGH,
			CreatedBy: o.owner.String(), DueDate: timestamppb.New(due), CreatedAt: timestamppb.Now(), UpdatedAt: timestamppb.Now(), Version: 3,
		}},
		NextPageToken: o.next,
	}, nil
}

func (o *tasksOwner) GetAllTaskStats(context.Context, *tasksv1.GetAllTaskStatsRequest) (*tasksv1.GetAllTaskStatsResponse, error) {
	return &tasksv1.GetAllTaskStatsResponse{Total: 10, Done: 4, Overdue: 1}, nil
}

func (o *tasksOwner) OperatorDeleteTask(ctx context.Context, req *tasksv1.OperatorDeleteTaskRequest) (*tasksv1.OperatorDeleteTaskResponse, error) {
	o.seen.deleteKey, o.seen.deleteTask = req.GetIdempotencyKey(), req.GetTaskId()
	info, _ := connect.CallInfoForServerContext(ctx)
	o.seen.authorization = info.RequestHeader().Get("Authorization")
	return &tasksv1.OperatorDeleteTaskResponse{OwnerId: o.owner.String()}, nil
}

func serve(t *testing.T, register func(*modulekit.Mounter)) modulekit.RemoteTarget {
	t.Helper()
	mux := http.NewServeMux()
	register(modulekit.NewMounter(mux, nil, nil, 1<<20, true))
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return modulekit.RemoteTarget{Name: "x", BaseURL: srv.URL, HTTPClient: srv.Client()}
}

func serveTasks(t *testing.T, o *tasksOwner) modulekit.RemoteTarget {
	return serve(t, func(mt *modulekit.Mounter) {
		modulekit.Mount(mt, tasksv1connect.RegisterTasksOperatorServiceHandler, tasksv1connect.TasksOperatorServiceHandler(o), 0)
	})
}

func serviceToken(string) remote.TokenSource {
	return func(context.Context) (string, error) { return "service-token", nil }
}

func TestTasks_ReadsForwardTheOperatorsToken(t *testing.T) {
	s, owner := &seen{}, ids.New()
	next := pagination.Cursor{Sort: tasksapi.AdminSortToken, Key: time.Now().UTC(), ID: ids.New()}
	c := remote.NewTasks(serveTasks(t, &tasksOwner{seen: s, owner: owner, next: next.Encode()}), nil)

	ctx := platformauth.WithBearer(context.Background(), "operator-token")
	res, err := c.ListAllTasks(ctx, nil, "", 20, &next)
	if err != nil {
		t.Fatal(err)
	}
	if s.authorization != "Bearer operator-token" {
		t.Errorf("owner saw Authorization %q, want the operator's token", s.authorization)
	}
	if s.listToken != next.Encode() {
		t.Errorf("owner saw page token %q, want the cursor re-encoded", s.listToken)
	}
	if len(res.Tasks) != 1 || res.Tasks[0].UserID != owner || res.Tasks[0].Status != tasksapi.StatusDone || res.Tasks[0].Priority != tasksapi.PriorityHigh || res.Tasks[0].DueDate == nil || res.Tasks[0].Version != 3 {
		t.Errorf("task = %+v", res.Tasks)
	}
	if res.Next == nil || res.Next.ID != next.ID {
		t.Errorf("next = %+v, want the owner's cursor decoded", res.Next)
	}

	stats, err := c.Stats(ctx)
	if err != nil || stats.Total != 10 || stats.Done != 4 || stats.Overdue != 1 {
		t.Errorf("Stats = %+v, %v", stats, err)
	}
}

func TestTasks_MutationUsesTheServiceIdentityAndTheEntryKey(t *testing.T) {
	s, owner, task := &seen{}, ids.New(), ids.New()
	c := remote.NewTasks(serveTasks(t, &tasksOwner{seen: s, owner: owner}), serviceToken(""))

	if err := c.Available(); err != nil {
		t.Fatal(err)
	}
	// An operator token on the context must NOT be what the mutation presents.
	ctx := platformauth.WithBearer(context.Background(), "operator-token")
	got, err := c.DeleteTask(ctx, "audit-1", task)
	if err != nil || got != owner {
		t.Fatalf("DeleteTask = %v, %v", got, err)
	}
	if s.authorization != "Bearer service-token" || s.deleteKey != "audit-1" || s.deleteTask != task.String() {
		t.Errorf("owner saw %+v", s)
	}
}

func TestTasks_WithoutAServiceIdentityMutationsAreRefused(t *testing.T) {
	c := remote.NewTasks(serveTasks(t, &tasksOwner{seen: &seen{}, owner: ids.New()}), nil)
	if sharederrors.KindOf(c.Available()) != sharederrors.KindFailedPrecondition {
		t.Errorf("Available = %v, want FailedPrecondition", c.Available())
	}
	if _, err := c.DeleteTask(context.Background(), "k", ids.New()); sharederrors.KindOf(err) != sharederrors.KindFailedPrecondition {
		t.Errorf("DeleteTask = %v, want FailedPrecondition and no call", err)
	}
}

func TestTasks_TransactionsDoNotCrossProcesses(t *testing.T) {
	c := remote.NewTasks(serveTasks(t, &tasksOwner{seen: &seen{}, owner: ids.New()}), nil)
	if _, err := c.DeleteTaskTx(context.Background(), nil, ids.New()); sharederrors.KindOf(err) != sharederrors.KindFailedPrecondition {
		t.Errorf("DeleteTaskTx = %v, want FailedPrecondition", err)
	}
}

type notificationsOwner struct {
	notificationsv1connect.UnimplementedNotificationsOperatorServiceHandler
	seen *seen
	err  error
}

func (o *notificationsOwner) CountAllActiveDevices(context.Context, *notificationsv1.CountAllActiveDevicesRequest) (*notificationsv1.CountAllActiveDevicesResponse, error) {
	return &notificationsv1.CountAllActiveDevicesResponse{Devices: 5}, nil
}

func (o *notificationsOwner) OperatorBroadcast(ctx context.Context, req *notificationsv1.OperatorBroadcastRequest) (*notificationsv1.OperatorBroadcastResponse, error) {
	o.seen.broadcast = req
	info, _ := connect.CallInfoForServerContext(ctx)
	o.seen.authorization = info.RequestHeader().Get("Authorization")
	if o.err != nil {
		return nil, o.err
	}
	return &notificationsv1.OperatorBroadcastResponse{Recipients: 7}, nil
}

func serveNotifications(t *testing.T, o *notificationsOwner) modulekit.RemoteTarget {
	return serve(t, func(mt *modulekit.Mounter) {
		modulekit.Mount(mt, notificationsv1connect.RegisterNotificationsOperatorServiceHandler, notificationsv1connect.NotificationsOperatorServiceHandler(o), 0)
	})
}

func TestNotifications_BroadcastAndCount(t *testing.T) {
	s := &seen{}
	c := remote.NewNotifications(serveNotifications(t, &notificationsOwner{seen: s}), serviceToken(""))
	user := ids.New()

	n, err := c.BroadcastIdempotent(context.Background(), "audit-2", &user, notificationsapi.Broadcast{Title: "T", Body: "B", Link: "/x"})
	if err != nil || n != 7 {
		t.Fatalf("BroadcastIdempotent = %d, %v", n, err)
	}
	b := s.broadcast
	if s.authorization != "Bearer service-token" || b.GetIdempotencyKey() != "audit-2" || b.GetUserId() != user.String() || b.GetTitle() != "T" || b.GetBody() != "B" || b.GetLink() != "/x" {
		t.Errorf("owner saw %+v with %q", b, s.authorization)
	}

	devices, err := c.CountActiveDevices(platformauth.WithBearer(context.Background(), "operator-token"))
	if err != nil || devices != 5 {
		t.Errorf("CountActiveDevices = %d, %v", devices, err)
	}
}

func TestNotifications_OwnerErrorsKeepTheirKind(t *testing.T) {
	owner := &notificationsOwner{seen: &seen{}, err: connect.NewError(connect.CodeInvalidArgument, "title must not be empty")}
	c := remote.NewNotifications(serveNotifications(t, owner), serviceToken(""))
	_, err := c.BroadcastIdempotent(context.Background(), "k", nil, notificationsapi.Broadcast{})
	if sharederrors.KindOf(err) != sharederrors.KindValidation {
		t.Fatalf("err = %v, want Validation (so the apply job fails the entry for good)", err)
	}

	if _, err := remote.NewNotifications(serveNotifications(t, owner), nil).BroadcastIdempotent(context.Background(), "k", nil, notificationsapi.Broadcast{}); sharederrors.KindOf(err) != sharederrors.KindFailedPrecondition {
		t.Fatalf("without a service identity: %v", err)
	}
}
