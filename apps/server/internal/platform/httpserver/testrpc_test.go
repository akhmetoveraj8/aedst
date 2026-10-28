package httpserver_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connecthttp"
	"google.golang.org/protobuf/types/known/emptypb"
)

// unaryMethod is a hand-registered unary procedure (no generated stubs):
// it reads one Empty request and answers one Empty response unless fn fails.
func unaryMethod(procedure string, fn func(context.Context) error) connect.Method {
	return connect.Method{
		Spec: connect.Spec{Procedure: procedure, StreamType: connect.StreamTypeUnary},
		Handler: func(ctx context.Context, _ connect.Spec, stream connect.ServerStream) error {
			if err := stream.Receive(&emptypb.Empty{}); err != nil {
				return err
			}
			if err := fn(ctx); err != nil {
				return err
			}
			return stream.Send(&emptypb.Empty{})
		},
	}
}

// newHandler is an http.Handler serving one unary procedure behind interceptors.
func newHandler(procedure string, fn func(context.Context) error, interceptors ...connect.ServerInterceptor) http.Handler {
	server := connect.NewServer(interceptors...)
	server.Register(unaryMethod(procedure, fn))
	mux := http.NewServeMux()
	connecthttp.Mount(mux, server)
	return mux
}

// callOption adjusts the client-side CallInfo of one call: set request headers
// before it, or keep the pointer to read response headers after it.
type callOption func(*connect.CallInfo)

func requestHeader(key, value string) callOption {
	return func(info *connect.CallInfo) { info.RequestHeader().Set(key, value) }
}

// callUnary calls procedure on srv once.
func callUnary(srv *httptest.Server, procedure string, opts ...callOption) error {
	client := connect.NewClient(connecthttp.NewTransport(srv.Client(), srv.URL))
	ctx, info := connect.NewClientContext(context.Background())
	for _, o := range opts {
		o(info)
	}
	return client.CallUnary(ctx, connect.Spec{Procedure: procedure, StreamType: connect.StreamTypeUnary}, &emptypb.Empty{}, &emptypb.Empty{})
}

// serve mounts one unary procedure behind interceptors and returns a caller.
func serve(t *testing.T, fn func(context.Context) error, interceptors ...connect.ServerInterceptor) func(...callOption) error {
	t.Helper()
	srv := httptest.NewServer(newHandler(testProcedure, fn, interceptors...))
	t.Cleanup(srv.Close)
	return func(opts ...callOption) error { return callUnary(srv, testProcedure, opts...) }
}

// callWithHeader runs interceptor in front of a stub handler directly through
// connect.Server (no HTTP) with one request header set (skipped when value is
// empty) and reports whether the handler ran, plus the error.
func callWithHeader(interceptor connect.ServerInterceptor, key, value string) (reached bool, err error) {
	server := connect.NewServer(interceptor)
	server.Register(connect.Method{
		Spec: connect.Spec{Procedure: testProcedure, StreamType: connect.StreamTypeUnary},
		Handler: func(context.Context, connect.Spec, connect.ServerStream) error {
			reached = true
			return nil
		},
	})
	info := &connect.CallInfo{}
	if value != "" {
		info.RequestHeader().Set(key, value)
	}
	err = server.Call(context.Background(), testProcedure, info, nil)
	return reached, err
}
