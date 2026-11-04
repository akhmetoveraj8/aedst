package modulekit

import (
	"bytes"
	"context"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connecthttp"

	tasksv1 "github.com/aedst/server/gen/go/aedst/tasks/v1"
	tasksv1connect "github.com/aedst/server/gen/go/aedst/tasks/v1/tasksv1connect"
)

type stubTasks struct {
	tasksv1connect.UnimplementedTasksServiceHandler
	called bool
}

func (s *stubTasks) GetTask(context.Context, *tasksv1.GetTaskRequest) (*tasksv1.GetTaskResponse, error) {
	s.called = true
	return &tasksv1.GetTaskResponse{}, nil
}

// The mounter must put protovalidate in front of every handler: a request
// violating the proto constraints never reaches the implementation.
func TestMount_AppliesProtovalidate(t *testing.T) {
	router := http.NewServeMux()
	m := NewMounter(router, nil, nil, 1<<20, true)
	stub := &stubTasks{}
	Mount(m, tasksv1connect.RegisterTasksServiceHandler, tasksv1connect.TasksServiceHandler(stub), 0)
	srv := httptest.NewServer(router)
	defer srv.Close()

	client := tasksv1connect.NewTasksServiceClient(connect.NewClient(connecthttp.NewTransport(srv.Client(), srv.URL)))
	_, err := client.GetTask(context.Background(), &tasksv1.GetTaskRequest{Id: "not-a-uuid"})
	if connect.CodeOf(err) != connect.CodeInvalidArgument || stub.called {
		t.Fatalf("err = %v, called = %v; want InvalidArgument before the handler", err, stub.called)
	}
	if _, err := client.GetTask(context.Background(), &tasksv1.GetTaskRequest{Id: "0190a3d8-7a5e-7c3b-8f2a-3c4d5e6f7a8b"}); err != nil || !stub.called {
		t.Fatalf("a valid request failed: %v", err)
	}
	if got := m.Services(); len(got) != 1 || got[0] != tasksv1connect.TasksServiceName {
		t.Errorf("Services() = %v", got)
	}
}

// Connect-Protocol-Version is required (CSRF defense in depth): a bare JSON
// POST, which an HTML form or a simple cross-site fetch could send, fails.
func TestMount_RequiresConnectProtocolHeader(t *testing.T) {
	router := http.NewServeMux()
	m := NewMounter(router, nil, nil, 1<<20, true)
	Mount(m, tasksv1connect.RegisterTasksServiceHandler, tasksv1connect.TasksServiceHandler(&stubTasks{}), 0)

	req := httptest.NewRequest(http.MethodPost, tasksv1connect.TasksServiceGetTaskProcedure, bytes.NewReader([]byte(`{"id":"0190a3d8-7a5e-7c3b-8f2a-3c4d5e6f7a8b"}`)))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code == http.StatusOK {
		t.Fatalf("status = %d without Connect-Protocol-Version, want a rejection", rec.Code)
	}
}

func TestMount_PerServiceReadLimit(t *testing.T) {
	router := http.NewServeMux()
	m := NewMounter(router, nil, nil, 1<<20, false)
	Mount(m, tasksv1connect.RegisterTasksServiceHandler, tasksv1connect.TasksServiceHandler(&stubTasks{}), 64)
	srv := httptest.NewServer(router)
	defer srv.Close()
	client := tasksv1connect.NewTasksServiceClient(connect.NewClient(connecthttp.NewTransport(srv.Client(), srv.URL)))
	_, err := client.GetTask(context.Background(), &tasksv1.GetTaskRequest{Id: strings.Repeat("x", 200)})
	if connect.CodeOf(err) != connect.CodeResourceExhausted {
		t.Fatalf("err = %v, want ResourceExhausted from the per-service limit", err)
	}
}

func TestVerifyKnown(t *testing.T) {
	m := NewMounter(http.NewServeMux(), nil, nil, 1<<20, false)
	Mount(m, tasksv1connect.RegisterTasksServiceHandler, tasksv1connect.TasksServiceHandler(&stubTasks{}), 0)
	if err := m.VerifyKnown(map[string]bool{tasksv1connect.TasksServiceGetTaskProcedure: true}); err != nil {
		t.Errorf("known service rejected: %v", err)
	}
	if err := m.VerifyKnown(map[string]bool{}); err == nil {
		t.Error("a mounted service missing from the known procedures must fail startup")
	}
}

type panickingTasks struct {
	tasksv1connect.UnimplementedTasksServiceHandler
}

func (panickingTasks) GetTask(context.Context, *tasksv1.GetTaskRequest) (*tasksv1.GetTaskResponse, error) {
	panic("boom: nil map write")
}

// A panic in one handler is one CodeInternal answer, logged with its stack and
// procedure, and the server keeps serving the next request.
func TestMount_RecoversHandlerPanics(t *testing.T) {
	var logs bytes.Buffer
	router := http.NewServeMux()
	m := NewMounter(router, nil, nil, 1<<20, true).WithLogger(slog.New(slog.NewTextHandler(&logs, nil)))
	Mount(m, tasksv1connect.RegisterTasksServiceHandler, tasksv1connect.TasksServiceHandler(panickingTasks{}), 0)
	srv := httptest.NewServer(router)
	defer srv.Close()

	client := tasksv1connect.NewTasksServiceClient(connect.NewClient(connecthttp.NewTransport(srv.Client(), srv.URL)))
	req := &tasksv1.GetTaskRequest{Id: "0190a3d8-7a5e-7c3b-8f2a-3c4d5e6f7a8b"}
	for range 2 { // the second call proves the process survived the first panic
		_, err := client.GetTask(context.Background(), req)
		if connect.CodeOf(err) != connect.CodeInternal {
			t.Fatalf("err = %v, want CodeInternal", err)
		}
		if strings.Contains(err.Error(), "boom") {
			t.Fatalf("the panic value leaked to the client: %v", err)
		}
	}
	for _, want := range []string{"rpc panic recovered", "TasksService/GetTask", "boom: nil map write", "mount_test.go"} {
		if !strings.Contains(logs.String(), want) {
			t.Errorf("log lacks %q:\n%s", want, logs.String())
		}
	}
}

// connect v2 interceptors wrap every RPC shape, streaming included (v1's
// UnaryInterceptorFunc skipped streams, which would have bypassed
// authentication). A rejecting interceptor must stop a bidi call before its
// handler runs.
func TestChainWrapsStreamingRPCs(t *testing.T) {
	deny := func(next connect.ServerFunc) connect.ServerFunc {
		return func(context.Context, connect.Spec, connect.ServerStream) error {
			return connect.NewError(connect.CodePermissionDenied, "denied")
		}
	}
	m := NewMounter(http.NewServeMux(), []connect.ServerInterceptor{deny}, nil, 1<<20, true)
	server := m.newServer()
	reached := false
	server.Register(connect.Method{
		Spec: connect.Spec{Procedure: "/x.v1.Stream/Watch", StreamType: connect.StreamTypeBidi},
		Handler: func(context.Context, connect.Spec, connect.ServerStream) error {
			reached = true
			return nil
		},
	})
	err := server.Call(context.Background(), "/x.v1.Stream/Watch", nil, nil)
	if connect.CodeOf(err) != connect.CodePermissionDenied || reached {
		t.Fatalf("err = %v, handler reached = %v; want the interceptor to stop a streaming call", err, reached)
	}
}
