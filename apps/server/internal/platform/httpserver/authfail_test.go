package httpserver_test

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"connectrpc.com/connect/v2"

	platformauth "github.com/aedst/server/internal/platform/auth"
	"github.com/aedst/server/internal/platform/httpserver"
	"github.com/aedst/server/internal/shared/ids"
)

type fakeVerifier struct{ ok string }

func (v fakeVerifier) VerifyAccessToken(_ context.Context, token string) (platformauth.Claims, error) {
	if token == v.ok {
		return platformauth.Claims{UserID: ids.New()}, nil
	}
	return platformauth.Claims{}, errors.New("bad token")
}

// failLimiter counts budget per key like the Dragonfly limiter, in memory.
type failLimiter struct {
	mu      sync.Mutex
	spent   map[string]int
	failing bool
}

func (l *failLimiter) Allow(_ context.Context, key string, limit int, _ time.Duration) (bool, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.failing {
		return true, errors.New("cache down")
	}
	l.spent[key]++
	return l.spent[key] <= limit, nil
}

func (l *failLimiter) Exhausted(_ context.Context, key string, limit int, _ time.Duration) (bool, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.failing {
		return false, errors.New("cache down")
	}
	return l.spent[key] >= limit, nil
}

func callWithToken(t *testing.T, h http.Handler, token string) connect.Code {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/pkg.Svc/Method", strings.NewReader("{}"))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Connect-Protocol-Version", "1")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	req.RemoteAddr = "203.0.113.9:4444"
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	switch rec.Code {
	case http.StatusOK:
		return 0
	case http.StatusTooManyRequests:
		return connect.CodeResourceExhausted
	case http.StatusUnauthorized:
		return connect.CodeUnauthenticated
	}
	t.Fatalf("unexpected HTTP status %d: %s", rec.Code, rec.Body.String())
	return 0
}

func authHandler(limiter *failLimiter, perMinute int) http.Handler {
	interceptor := httpserver.AuthInterceptor(fakeVerifier{ok: "good"}, nil, slog.New(slog.NewTextHandler(io.Discard, nil)),
		httpserver.WithFailureThrottle(limiter, perMinute))
	return newHandler("/pkg.Svc/Method", func(context.Context) error { return nil }, interceptor)
}

func TestAuthFailureThrottle(t *testing.T) {
	limiter := &failLimiter{spent: map[string]int{}}
	h := authHandler(limiter, 3)

	for i := range 3 {
		if got := callWithToken(t, h, "bad"); got != connect.CodeUnauthenticated {
			t.Fatalf("failure %d = %v, want unauthenticated", i+1, got)
		}
	}
	if got := callWithToken(t, h, "bad"); got != connect.CodeResourceExhausted {
		t.Fatalf("after the budget is spent = %v, want resource_exhausted", got)
	}
	// Even a valid token is refused from a throttled address (it is looked at only after the check).
	if got := callWithToken(t, h, "good"); got != connect.CodeResourceExhausted {
		t.Fatalf("valid token from a throttled address = %v, want resource_exhausted", got)
	}
}

func TestAuthFailureThrottle_SuccessCostsNothing(t *testing.T) {
	limiter := &failLimiter{spent: map[string]int{}}
	h := authHandler(limiter, 2)
	for range 20 {
		if got := callWithToken(t, h, "good"); got != 0 {
			t.Fatalf("valid request = %v", got)
		}
	}
	if len(limiter.spent) != 0 {
		t.Fatalf("successful requests spent budget: %v", limiter.spent)
	}
}

func TestAuthFailureThrottle_FailsOpen(t *testing.T) {
	limiter := &failLimiter{spent: map[string]int{}, failing: true}
	h := authHandler(limiter, 1)
	for range 3 {
		if got := callWithToken(t, h, "good"); got != 0 {
			t.Fatalf("limiter outage blocked a valid request: %v", got)
		}
	}
	if got := callWithToken(t, h, "bad"); got != connect.CodeUnauthenticated {
		t.Fatalf("invalid token during an outage = %v, want unauthenticated (still verified)", got)
	}
}

type unavailableVerifier struct{}

func (unavailableVerifier) VerifyAccessToken(context.Context, string) (platformauth.Claims, error) {
	return platformauth.Claims{}, platformauth.ErrOIDCUnavailable
}

// An identity-provider outage is UNAVAILABLE (retryable), not "unauthenticated", and
// it must not drain the caller's failed-authentication budget.
func TestAuthInterceptor_ProviderOutageIsUnavailableAndFreeOfCharge(t *testing.T) {
	limiter := &failLimiter{spent: map[string]int{}}
	interceptor := httpserver.AuthInterceptor(unavailableVerifier{}, nil, slog.New(slog.NewTextHandler(io.Discard, nil)),
		httpserver.WithFailureThrottle(limiter, 1))
	h := newHandler("/pkg.Svc/Method", func(context.Context) error { return nil }, interceptor)
	for range 3 {
		req := httptest.NewRequest(http.MethodPost, "/pkg.Svc/Method", strings.NewReader("{}"))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Connect-Protocol-Version", "1")
		req.Header.Set("Authorization", "Bearer a.b.c")
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != http.StatusServiceUnavailable {
			t.Fatalf("status = %d, want 503 while the provider is down", rec.Code)
		}
		if rec.Header().Get("Retry-After") == "" {
			t.Fatal("UNAVAILABLE must carry Retry-After")
		}
	}
	if len(limiter.spent) != 0 {
		t.Fatalf("an outage spent the failed-authentication budget: %v", limiter.spent)
	}
}
