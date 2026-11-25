package httpserver_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"connectrpc.com/connect/v2"
	"connectrpc.com/grpchealth/v2"

	platformauth "github.com/aedst/server/internal/platform/auth"
	"github.com/aedst/server/internal/platform/httpserver"
	sharederrors "github.com/aedst/server/internal/shared/errors"
	"github.com/aedst/server/internal/shared/ids"
)

const testProcedure = "/test.v1.Svc/Do"

// withIdentity is a stand-in for AuthInterceptor: it puts an identity on the
// context of every call.
func withIdentity(identity platformauth.Identity) connect.ServerInterceptor {
	return func(next connect.ServerFunc) connect.ServerFunc {
		return func(ctx context.Context, spec connect.Spec, stream connect.ServerStream) error {
			return next(platformauth.WithIdentity(ctx, identity), spec, stream)
		}
	}
}

func TestToConnectError_NeverLeaksInternalsAndKeepsTheCause(t *testing.T) {
	cause := errors.New("pq: connection refused to 10.0.0.5:5432")
	wrapped := sharederrors.Wrap("tasks.Create", cause)

	err := httpserver.ToConnectError(wrapped)
	if connect.CodeOf(err) != connect.CodeInternal {
		t.Fatalf("code = %v, want Internal", connect.CodeOf(err))
	}
	var connErr *connect.Error
	if !errors.As(err, &connErr) || strings.Contains(connErr.Message(), "10.0.0.5") || connErr.Message() != "internal error" {
		t.Fatalf("client-visible message = %q, want the generic one", connErr.Message())
	}
	if !errors.Is(err, cause) {
		t.Error("the real cause must stay reachable server-side through errors.Is")
	}

	notFound := httpserver.ToConnectError(sharederrors.NotFound("tasks.Update", "task not found"))
	if connect.CodeOf(notFound) != connect.CodeNotFound {
		t.Fatalf("code = %v, want NotFound", connect.CodeOf(notFound))
	}
	var notFoundErr *connect.Error
	if !errors.As(notFound, &notFoundErr) || notFoundErr.Message() != "task not found" {
		t.Errorf("message = %v, want the domain message without the operation name", notFound)
	}

	if got := connect.CodeOf(httpserver.ToConnectError(fmt.Errorf("db: %w", context.Canceled))); got != connect.CodeCanceled {
		t.Errorf("context.Canceled mapped to %v, want Canceled (a client hang-up is not a server fault)", got)
	}
	if got := connect.CodeOf(httpserver.ToConnectError(context.DeadlineExceeded)); got != connect.CodeDeadlineExceeded {
		t.Errorf("DeadlineExceeded mapped to %v", got)
	}
}

func TestErrorLogInterceptor_LogsServerFaultsWithCauseNotClientErrors(t *testing.T) {
	var buf bytes.Buffer
	var mu sync.Mutex
	logger := slog.New(slog.NewJSONHandler(&lockedWriter{w: &buf, mu: &mu}, nil))
	failure := error(sharederrors.Wrap("tasks.Create", errors.New("disk on fire")))
	call := serve(t, func(context.Context) error { return httpserver.ToConnectError(failure) }, httpserver.ErrorLogInterceptor(logger))

	err := call()
	if connect.CodeOf(err) != connect.CodeInternal {
		t.Fatalf("client saw %v, want Internal", err)
	}
	if strings.Contains(err.Error(), "disk on fire") {
		t.Fatalf("cause leaked to the client: %v", err)
	}
	mu.Lock()
	logged := buf.String()
	mu.Unlock()
	for _, want := range []string{`"level":"ERROR"`, "disk on fire", testProcedure, `"code":"internal"`} {
		if !strings.Contains(logged, want) {
			t.Errorf("log %q lacks %q", logged, want)
		}
	}

	buf.Reset()
	failure = sharederrors.NotFound("tasks.Get", "task not found")
	if err := call(); connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("err = %v, want NotFound", err)
	}
	mu.Lock()
	defer mu.Unlock()
	if buf.Len() != 0 {
		t.Errorf("a client error was logged as a fault: %s", buf.String())
	}
}

type lockedWriter struct {
	w  *bytes.Buffer
	mu *sync.Mutex
}

func (l *lockedWriter) Write(p []byte) (int, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.w.Write(p)
}

func TestRoleInterceptor(t *testing.T) {
	policy := map[string][]string{testProcedure: {"admin", "support"}}
	ok := func(context.Context) error { return nil }

	tests := []struct {
		name     string
		identity *platformauth.Identity
		want     connect.Code
	}{
		{"holds a required role", &platformauth.Identity{Roles: []string{"user", "support"}}, 0},
		{"lacks every required role", &platformauth.Identity{Roles: []string{"user"}}, connect.CodePermissionDenied},
		{"no roles at all", &platformauth.Identity{}, connect.CodePermissionDenied},
		{"no identity", nil, connect.CodeUnauthenticated},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			interceptors := []connect.ServerInterceptor{}
			if tt.identity != nil {
				interceptors = append(interceptors, withIdentity(*tt.identity))
			}
			interceptors = append(interceptors, httpserver.RoleInterceptor(policy))
			err := serve(t, ok, interceptors...)()
			if tt.want == 0 && err != nil || tt.want != 0 && connect.CodeOf(err) != tt.want {
				t.Fatalf("err = %v, want code %v", err, tt.want)
			}
		})
	}

	// Procedures outside the policy only need authentication.
	if err := serve(t, ok, httpserver.RoleInterceptor(map[string][]string{"/other/Proc": {"admin"}}))(); err != nil {
		t.Fatalf("unlisted procedure was restricted: %v", err)
	}
}

func TestUserRateLimitInterceptor(t *testing.T) {
	ok := func(context.Context) error { return nil }
	user := ids.New()

	limiter := &stubLimiter{allowed: false}
	call := serve(t, ok, withIdentity(platformauth.Identity{UserID: user}), httpserver.UserRateLimitInterceptor(limiter, 60, discardLogger()))
	var info *connect.CallInfo
	err := call(func(i *connect.CallInfo) { info = i })
	if connect.CodeOf(err) != connect.CodeResourceExhausted {
		t.Fatalf("over budget: err = %v, want ResourceExhausted", err)
	}
	if info.ResponseHeader().Get("Retry-After") == "" {
		t.Error("a throttled response should tell the client when to retry")
	}
	if len(limiter.keys) != 1 || limiter.keys[0] != "rl:user:"+user.String() {
		t.Fatalf("limiter keys = %v, want one key per user", limiter.keys)
	}

	limiter.err = errors.New("cache down") // degraded: the stub plays cache.RateLimiter's in-process fallback
	if err := call(); connect.CodeOf(err) != connect.CodeResourceExhausted {
		t.Fatalf("during a limiter outage the fallback decision (over budget) must be honoured, got %v", err)
	}
	limiter.allowed = true
	if err := call(); err != nil {
		t.Fatalf("during a limiter outage a request within the fallback budget must pass, got %v", err)
	}

	// No identity (a public procedure): not this interceptor's business.
	anonymous := &stubLimiter{allowed: false}
	if err := serve(t, ok, httpserver.UserRateLimitInterceptor(anonymous, 60, discardLogger()))(); err != nil || len(anonymous.keys) != 0 {
		t.Fatalf("anonymous call = %v, limiter keys %v; want it to pass untouched", err, anonymous.keys)
	}
}

func TestRouter_LoadSheddingRejectsExcessButNeverProbes(t *testing.T) {
	release := make(chan struct{})
	entered := make(chan struct{}, 4)
	router := httpserver.NewRouter(httpserver.Options{Logger: discardLogger(), MaxInFlight: 2})
	router.HandleFunc("GET /slow", func(w http.ResponseWriter, _ *http.Request) {
		entered <- struct{}{}
		<-release
	})
	srv := httptest.NewServer(router)
	t.Cleanup(srv.Close)

	var wg sync.WaitGroup
	for range 2 {
		wg.Go(func() {
			resp, err := http.Get(srv.URL + "/slow")
			if err == nil {
				_ = resp.Body.Close()
			}
		})
	}
	<-entered
	<-entered // both slots are now busy

	resp, err := http.Get(srv.URL + "/slow")
	if err != nil {
		t.Fatalf("GET: %v", err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusTooManyRequests || resp.Header.Get("Retry-After") == "" {
		t.Errorf("excess request = %d (Retry-After %q), want 429 with Retry-After", resp.StatusCode, resp.Header.Get("Retry-After"))
	}
	for _, probe := range []string{"/livez", "/readyz"} {
		resp, err := http.Get(srv.URL + probe)
		if err != nil {
			t.Fatalf("GET %s: %v", probe, err)
		}
		_ = resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			t.Errorf("%s = %d while saturated, want 200 (probes are never shed)", probe, resp.StatusCode)
		}
	}
	close(release)
	wg.Wait()
}

func TestRouter_SecurityHeaders(t *testing.T) {
	router := httpserver.NewRouter(httpserver.Options{Logger: discardLogger()})
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/livez", nil))
	for header, want := range map[string]string{
		"X-Content-Type-Options": "nosniff",
		"Cache-Control":          "no-store",
		"Referrer-Policy":        "no-referrer",
	} {
		if got := rec.Header().Get(header); got != want {
			t.Errorf("%s = %q, want %q", header, got, want)
		}
	}
	if csp := rec.Header().Get("Content-Security-Policy"); !strings.Contains(csp, "frame-ancestors 'none'") {
		t.Errorf("Content-Security-Policy = %q, want it to forbid framing", csp)
	}
}

func TestReadiness_OptionalDependencyDegradesInsteadOfFailing(t *testing.T) {
	cacheUp := false
	readiness := httpserver.NewReadiness(
		httpserver.Check{Name: "database", Fn: func(context.Context) error { return nil }},
		httpserver.Check{Name: "cache", Optional: true, Fn: func(context.Context) error {
			if cacheUp {
				return nil
			}
			return errors.New("down")
		}},
	).WithCacheTTL(0)
	router := httpserver.NewRouter(httpserver.Options{Logger: discardLogger(), Readiness: readiness})
	get := func() (int, map[string]any) {
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/readyz", nil))
		var body map[string]any
		_ = json.Unmarshal(rec.Body.Bytes(), &body)
		return rec.Code, body
	}

	code, body := get()
	if code != http.StatusOK || body["status"] != "degraded" {
		t.Fatalf("cache down: /readyz = %d %v, want 200 degraded (a cache outage must not empty the pool of replicas)", code, body)
	}
	cacheUp = true
	if code, body := get(); code != http.StatusOK || body["status"] != "ok" {
		t.Fatalf("all up: /readyz = %d %v, want 200 ok", code, body)
	}
}

func TestHealthChecker_FollowsReadiness(t *testing.T) {
	databaseUp := true
	readiness := httpserver.NewReadiness(httpserver.Check{Name: "database", Fn: func(context.Context) error {
		if databaseUp {
			return nil
		}
		return errors.New("down")
	}})
	checker := httpserver.NewHealthChecker(readiness, "test.v1.Svc")
	check := func(service string) (grpchealth.Status, error) {
		resp, err := checker.Check(context.Background(), &grpchealth.CheckRequest{Service: service})
		if err != nil {
			return 0, err
		}
		return resp.Status, nil
	}

	if status, err := check(""); err != nil || status != grpchealth.StatusServing {
		t.Fatalf("healthy server = %v, %v; want serving", status, err)
	}
	if status, err := check("test.v1.Svc"); err != nil || status != grpchealth.StatusServing {
		t.Fatalf("known service = %v, %v; want serving", status, err)
	}
	if _, err := check("nope.v1.Missing"); connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("unknown service err = %v, want NotFound", err)
	}
	databaseUp = false
	if status, _ := check(""); status != grpchealth.StatusNotServing {
		t.Fatalf("database down = %v, want not serving", status)
	}
	databaseUp = true
	readiness.SetDraining()
	if status, _ := check(""); status != grpchealth.StatusNotServing {
		t.Fatalf("draining = %v, want not serving", status)
	}
}
