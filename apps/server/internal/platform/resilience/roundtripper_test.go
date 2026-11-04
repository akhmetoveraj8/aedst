package resilience_test

import (
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/aedst/server/internal/platform/resilience"
)

// The default timeout must not cut the response body short: callers read the
// body AFTER RoundTrip returns, so the deadline has to live until Close.
func TestRoundTripper_BodyIsReadableAfterRoundTripReturns(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(w, strings.Repeat("x", 1<<16))
	}))
	t.Cleanup(srv.Close)

	client := &http.Client{Transport: resilience.WrapRoundTripper(http.DefaultTransport, resilience.Config{
		BreakerName: "test", Timeout: 5 * time.Second, MaxRequests: 1, RateLimitRPS: 100,
	})}
	resp, err := client.Get(srv.URL)
	if err != nil {
		t.Fatalf("GET: %v", err)
	}
	defer func() { _ = resp.Body.Close() }()
	body, err := io.ReadAll(resp.Body)
	if err != nil || len(body) != 1<<16 {
		t.Fatalf("read body = %d bytes, %v; want the whole 65536 (a cancelled context truncates it)", len(body), err)
	}
}

type failingTransport struct{ calls int }

func (f *failingTransport) RoundTrip(*http.Request) (*http.Response, error) {
	f.calls++
	return nil, errors.New("connection refused")
}

// A dependency that keeps failing at the transport level stops being called:
// the breaker opens after its consecutive-failure threshold and rejects
// immediately, instead of every request waiting out a dial timeout.
func TestRoundTripper_BreakerOpensOnRepeatedTransportFailures(t *testing.T) {
	next := &failingTransport{}
	rt := resilience.WrapRoundTripper(next, resilience.Config{BreakerName: "dead", Timeout: time.Second, MaxRequests: 1, RateLimitRPS: 1000})
	req := func() error {
		r, _ := http.NewRequest(http.MethodGet, "http://dependency.invalid/", nil)
		resp, err := rt.RoundTrip(r)
		if resp != nil {
			_ = resp.Body.Close()
		}
		return err
	}

	for range 10 {
		if req() == nil {
			t.Fatal("a failing dependency reported success")
		}
	}
	if next.calls >= 10 {
		t.Fatalf("the dependency was called %d times; the breaker should have opened and short-circuited the rest", next.calls)
	}
}
