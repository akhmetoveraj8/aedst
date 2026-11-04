package push_test

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/sony/gobreaker/v2"

	"github.com/aedst/server/internal/platform/push"
)

// A provider that stops answering opens its own breaker: later sends fail fast with
// gobreaker.ErrOpenState instead of each waiting out the full dial timeout, and the
// other providers' clients are unaffected.
func TestNewHTTPClient_BreakerOpensPerProvider(t *testing.T) {
	dead := httptest.NewServer(http.NotFoundHandler())
	url := dead.URL
	dead.Close() // connection refused from here on

	apns := push.NewHTTPClient(2*time.Second, "apns-test")
	other := push.NewHTTPClient(2*time.Second, "webpush-test")
	get := func(c *http.Client, target string) error {
		req, _ := http.NewRequestWithContext(context.Background(), http.MethodGet, target, nil)
		resp, err := c.Do(req)
		if err == nil {
			_ = resp.Body.Close()
		}
		return err
	}

	var openErr error
	for range 10 {
		if err := get(apns, url); errors.Is(err, gobreaker.ErrOpenState) {
			openErr = err
			break
		}
	}
	if openErr == nil {
		t.Fatal("the breaker never opened after repeated transport failures")
	}

	live := httptest.NewServer(http.NotFoundHandler())
	defer live.Close()
	if err := get(other, live.URL); err != nil {
		t.Fatalf("another provider's client was affected by apns' breaker: %v", err)
	}
}
