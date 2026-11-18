package observability_test

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/aedst/server/internal/platform/observability"
)

func TestStartProfiling_DisabledIsNoop(t *testing.T) {
	p, err := observability.StartProfiling(observability.ProfilingConfig{}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatal(err)
	}
	if err := p.Stop(context.Background()); err != nil {
		t.Fatal(err)
	}
}

func TestStartProfiling_RequiresServerAddress(t *testing.T) {
	_, err := observability.StartProfiling(observability.ProfilingConfig{Enabled: true}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err == nil {
		t.Fatal("want an error without a server address")
	}
}

// The adapter must push profiles to the backend with the configured credentials.
func TestStartProfiling_UploadsToBackend(t *testing.T) {
	var uploads atomic.Int32
	var user, tenant atomic.Value
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/ingest" {
			u, _, _ := r.BasicAuth()
			user.Store(u)
			tenant.Store(r.Header.Get("X-Scope-OrgID"))
			uploads.Add(1)
		}
		_, _ = io.Copy(io.Discard, r.Body)
	}))
	defer srv.Close()

	p, err := observability.StartProfiling(observability.ProfilingConfig{
		Enabled: true, ServerAddress: srv.URL, ApplicationName: "aedst-test",
		BasicAuthUser: "u1", BasicAuthPassword: "secret", TenantID: "t1",
		Tags: map[string]string{"env": "test"}, UploadRate: time.Second,
	}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(15 * time.Second)
	for uploads.Load() == 0 && time.Now().Before(deadline) {
		time.Sleep(100 * time.Millisecond)
	}
	if err := p.Stop(context.Background()); err != nil {
		t.Fatal(err)
	}
	if uploads.Load() == 0 {
		t.Fatal("no profile reached the backend")
	}
	if user.Load() != "u1" || tenant.Load() != "t1" {
		t.Errorf("credentials/tenant = %v / %v", user.Load(), tenant.Load())
	}
}
