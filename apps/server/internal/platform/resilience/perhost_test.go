package resilience_test

import (
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/sony/gobreaker/v2"

	"github.com/aedst/server/internal/platform/resilience"
)

// hostTransport fails every request to dead.invalid and answers the rest.
type hostTransport struct{}

func (hostTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	if r.URL.Host == "dead.invalid" {
		return nil, errors.New("connection timed out")
	}
	return &http.Response{StatusCode: http.StatusCreated, Body: io.NopCloser(strings.NewReader("")), Request: r}, nil
}

// One host that keeps failing opens only its own breaker: requests to every
// other host still go through.
func TestPerHost_OneDeadHostDoesNotOpenTheOthersBreaker(t *testing.T) {
	rt := resilience.WrapRoundTripperPerHost(hostTransport{}, resilience.Config{BreakerName: "webpush", Timeout: time.Second, MaxRequests: 1, RateLimitRPS: 1000})
	send := func(host string) error {
		r, _ := http.NewRequest(http.MethodPost, "https://"+host+"/x", nil)
		resp, err := rt.RoundTrip(r)
		if resp != nil {
			_ = resp.Body.Close()
		}
		return err
	}

	var open bool
	for range 10 {
		if errors.Is(send("dead.invalid"), gobreaker.ErrOpenState) {
			open = true
			break
		}
	}
	if !open {
		t.Fatal("the failing host's breaker never opened")
	}
	if err := send("fcm.googleapis.com"); err != nil {
		t.Fatalf("a healthy host was affected by another host's breaker: %v", err)
	}
}
