package push

import (
	"errors"
	"fmt"
	"net"
	"net/http"
	"syscall"
	"time"

	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"

	"github.com/aedst/server/internal/platform/netguard"
	"github.com/aedst/server/internal/platform/resilience"
)

// ErrBlockedAddress is returned when a Web Push endpoint resolves to an address
// the server must never call (loopback, private, link-local, metadata, ...).
var ErrBlockedAddress = errors.New("push: web push endpoint resolves to a non-public address")

// NewWebPushHTTPClient is the client for Web Push. Unlike FCM and APNs, the
// target URL comes from a user's browser subscription, so on top of what
// NewHTTPClient does it:
//
//   - refuses to connect to non-public addresses, checked on the resolved IP at
//     dial time (so DNS rebinding cannot bypass it); it ignores HTTP(S)_PROXY
//     for the same reason: through a proxy the dial would only see the proxy;
//   - never follows redirects (a push service answers 201; a 3xx is returned
//     as is and classified as a failure);
//   - keeps one circuit breaker and rate limiter per endpoint host, so one
//     user's blackholing endpoint cannot open the breaker for every user.
func NewWebPushHTTPClient(timeout time.Duration) *http.Client {
	return newWebPushHTTPClient(timeout, guardPublicAddress)
}

// guardPublicAddress is the net.Dialer Control hook: the shared SSRF guard
// (platform/netguard) checks the resolved ip:port about to be connected to.
func guardPublicAddress(network, address string, c syscall.RawConn) error {
	if err := netguard.Control(network, address, c); err != nil {
		return fmt.Errorf("%w: %w", ErrBlockedAddress, err)
	}
	return nil
}

func newWebPushHTTPClient(timeout time.Duration, control func(network, address string, c syscall.RawConn) error) *http.Client {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = nil
	transport.ForceAttemptHTTP2 = true
	dialer := &net.Dialer{Timeout: timeout, KeepAlive: 30 * time.Second, Control: control}
	transport.DialContext = dialer.DialContext
	var rt http.RoundTripper = otelhttp.NewTransport(transport)
	rt = resilience.WrapRoundTripperPerHost(rt, resilience.Config{
		BreakerName:  "push-webpush",
		Timeout:      timeout,
		MaxRequests:  3,
		RateLimitRPS: providerRateLimitRPS,
	})
	return &http.Client{
		Timeout:       timeout,
		Transport:     rt,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
}
