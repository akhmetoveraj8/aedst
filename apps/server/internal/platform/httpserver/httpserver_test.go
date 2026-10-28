package httpserver_test

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connecthttp"

	"github.com/aedst/server/internal/platform/httpserver"
)

func discardLogger() *slog.Logger { return slog.New(slog.DiscardHandler) }

func TestRouter_Readyz_ReportsFailedDependenciesAndDraining(t *testing.T) {
	healthy := true
	readiness := httpserver.NewReadiness(httpserver.Check{Name: "database", Fn: func(context.Context) error {
		if healthy {
			return nil
		}
		return errors.New("down")
	}}).WithCacheTTL(0)
	router := httpserver.NewRouter(httpserver.Options{Logger: discardLogger(), Readiness: readiness})

	get := func() (int, string) {
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/readyz", nil))
		return rec.Code, rec.Body.String()
	}

	if code, _ := get(); code != http.StatusOK {
		t.Fatalf("healthy /readyz = %d, want 200", code)
	}
	healthy = false
	if code, body := get(); code != http.StatusServiceUnavailable || !strings.Contains(body, "database") || strings.Contains(body, "down") {
		t.Fatalf("unhealthy /readyz = %d %q, want 503 naming the check but not its error", code, body)
	}
	healthy = true
	readiness.SetDraining()
	if code, _ := get(); code != http.StatusServiceUnavailable {
		t.Fatalf("draining /readyz = %d, want 503", code)
	}
}

func TestRouter_Livez_IsIndependentOfDependencies(t *testing.T) {
	readiness := httpserver.NewReadiness(httpserver.Check{Name: "x", Fn: func(context.Context) error { return errors.New("down") }})
	router := httpserver.NewRouter(httpserver.Options{Logger: discardLogger(), Readiness: readiness})

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/livez", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("/livez = %d, want 200 even when dependencies are down", rec.Code)
	}
}

func TestRouter_RequestID_RejectsUnsafeClientValues(t *testing.T) {
	router := httpserver.NewRouter(httpserver.Options{Logger: discardLogger()})
	router.HandleFunc("GET /x", func(http.ResponseWriter, *http.Request) {})

	for _, bad := range []string{"has space", "new\nline", strings.Repeat("a", 65)} {
		req := httptest.NewRequest(http.MethodGet, "/x", nil)
		req.Header.Set("X-Request-Id", bad)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		if got := rec.Header().Get("X-Request-Id"); got == bad || got == "" {
			t.Errorf("request id %q was echoed or dropped: got %q", bad, got)
		}
	}

	req := httptest.NewRequest(http.MethodGet, "/x", nil)
	req.Header.Set("X-Request-Id", "abc-123")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if got := rec.Header().Get("X-Request-Id"); got != "abc-123" {
		t.Errorf("valid request id not preserved: %q", got)
	}
}

func TestRouter_RecoversFromPanics(t *testing.T) {
	router := httpserver.NewRouter(httpserver.Options{Logger: discardLogger()})
	router.HandleFunc("GET /boom", func(http.ResponseWriter, *http.Request) { panic("kaboom") })

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/boom", nil))
	if rec.Code != http.StatusInternalServerError || strings.Contains(rec.Body.String(), "kaboom") {
		t.Fatalf("panic response = %d %q, want a generic 500", rec.Code, rec.Body.String())
	}
}

type stubLimiter struct {
	allowed bool
	err     error
	keys    []string
}

func (s *stubLimiter) Allow(_ context.Context, key string, _ int, _ time.Duration) (bool, error) {
	s.keys = append(s.keys, key)
	return s.allowed, s.err
}

// TestRateLimitInterceptor_EndToEnd drives a real Connect handler through the
// interceptor: listed procedures are throttled (429-equivalent
// ResourceExhausted), unlisted ones are not, and limiter outages fail open.
func TestRateLimitInterceptor_EndToEnd(t *testing.T) {
	const limited, open = "/test.v1.Svc/Limited", "/test.v1.Svc/Open"
	limiter := &stubLimiter{allowed: false}
	interceptor := httpserver.RateLimitInterceptor(limiter, map[string]bool{limited: true}, 5, discardLogger())

	ok := func(context.Context) error { return nil }
	server := connect.NewServer(interceptor)
	server.Register(unaryMethod(limited, ok), unaryMethod(open, ok))
	mux := http.NewServeMux()
	connecthttp.Mount(mux, server)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)

	call := func(procedure string) error { return callUnary(srv, procedure) }

	if err := call(limited); connect.CodeOf(err) != connect.CodeResourceExhausted {
		t.Fatalf("limited procedure over budget: err = %v, want ResourceExhausted", err)
	}
	if len(limiter.keys) != 1 || !strings.HasPrefix(limiter.keys[0], "rl:"+limited+":") {
		t.Fatalf("limiter keys = %v, want one key scoped to the procedure and client", limiter.keys)
	}
	if err := call(open); err != nil {
		t.Fatalf("unlisted procedure was throttled: %v", err)
	}

	limiter.err = errors.New("valkey down")
	if err := call(limited); err != nil {
		t.Fatalf("limiter outage must fail open, got %v", err)
	}
}
