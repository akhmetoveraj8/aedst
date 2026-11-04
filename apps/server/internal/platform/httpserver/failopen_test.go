package httpserver_test

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"strings"
	"testing"

	platformauth "github.com/aedst/server/internal/platform/auth"
	"github.com/aedst/server/internal/platform/httpserver"
	"github.com/aedst/server/internal/shared/ids"
)

// During a limiter outage every request takes the fail-open path; it must log
// once, not once per request.
func TestUserRateLimitInterceptor_FailOpenWarningIsThrottled(t *testing.T) {
	var buf bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&buf, nil))
	limiter := &stubLimiter{allowed: true, err: errors.New("valkey down")}
	call := serve(t, func(context.Context) error { return nil },
		withIdentity(platformauth.Identity{UserID: ids.New()}),
		httpserver.UserRateLimitInterceptor(limiter, 60, logger))

	for range 20 {
		if err := call(); err != nil {
			t.Fatalf("a limiter outage must not fail requests: %v", err)
		}
	}
	if warnings := strings.Count(buf.String(), "failing open"); warnings != 1 {
		t.Fatalf("logged %d warnings for 20 requests, want 1", warnings)
	}
}
