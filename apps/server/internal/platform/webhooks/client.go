package webhooks

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"slices"
	"strings"
	"syscall"
	"time"

	"github.com/aedst/server/internal/platform/netguard"
	"github.com/aedst/server/internal/platform/resilience"
)

// ErrForbiddenAddress is returned when a delivery would connect to an address
// that is not a public unicast address, or to a host outside the allowlist.
var ErrForbiddenAddress = errors.New("webhooks: destination address is not allowed")

// ClientConfig tunes the outbound client.
type ClientConfig struct {
	// AllowedHosts restricts deliveries to these host names (exact, or a
	// ".example.com" suffix). Empty allows any host that resolves to a public
	// address: endpoint URLs are registered by customers, so the address check is
	// the boundary and the list is an extra for closed deployments.
	AllowedHosts []string
	// RateLimitRPS caps deliveries per destination host (default 10).
	RateLimitRPS float64
}

// NewHTTPClient is the only client deliveries may use. It protects against SSRF
// (docs/content/engineering/security.md): the address is checked when the socket
// connects, after DNS resolution, so a host name that resolves (or is re-bound)
// to a loopback, private, link-local, carrier-grade NAT or metadata address is
// refused; redirects are never followed (a receiver cannot bounce the request
// inward); proxies from the environment are ignored; every host has its own
// circuit breaker, rate limit and timeout (platform/resilience).
//
// Custom code is justified: the standard library has no "public addresses only"
// dialer and no module in go.mod provides one; the guard is net.Dialer.Control
// plus net/netip predicates.
func NewHTTPClient(cfg ClientConfig) *http.Client {
	if cfg.RateLimitRPS <= 0 {
		cfg.RateLimitRPS = 10
	}
	dialer := &net.Dialer{Timeout: 5 * time.Second, Control: publicAddressOnly}
	transport := &http.Transport{
		Proxy:                  nil,
		DialContext:            dialer.DialContext,
		ForceAttemptHTTP2:      true,
		TLSHandshakeTimeout:    5 * time.Second,
		ResponseHeaderTimeout:  deliveryTimeout,
		MaxIdleConnsPerHost:    2,
		IdleConnTimeout:        30 * time.Second,
		MaxResponseHeaderBytes: 16 << 10,
	}
	guarded := hostAllowlist{next: resilience.WrapRoundTripperPerHost(transport, resilience.Config{
		BreakerName: "webhooks", Timeout: deliveryTimeout, MaxRequests: 1, RateLimitRPS: cfg.RateLimitRPS,
	}), allowed: cfg.AllowedHosts}
	return &http.Client{
		Transport: guarded,
		Timeout:   deliveryTimeout,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
}

// publicAddressOnly is the net.Dialer.Control hook: the shared SSRF guard
// (platform/netguard) checks the literal IP the socket is about to connect to.
func publicAddressOnly(network, address string, c syscall.RawConn) error {
	if err := netguard.Control(network, address, c); err != nil {
		return fmt.Errorf("%w: %w", ErrForbiddenAddress, err)
	}
	return nil
}

// hostAllowlist refuses hosts outside the configured list before any dial.
type hostAllowlist struct {
	next    http.RoundTripper
	allowed []string
}

func (h hostAllowlist) RoundTrip(req *http.Request) (*http.Response, error) {
	if len(h.allowed) > 0 && !hostAllowed(req.URL.Hostname(), h.allowed) {
		return nil, fmt.Errorf("%w: host %q is not in the allowlist", ErrForbiddenAddress, req.URL.Hostname())
	}
	resp, err := h.next.RoundTrip(req)
	if err != nil {
		return nil, fmt.Errorf("webhooks: %w", err)
	}
	return resp, nil
}

func hostAllowed(host string, allowed []string) bool {
	host = strings.ToLower(strings.TrimSuffix(host, "."))
	return slices.ContainsFunc(allowed, func(entry string) bool {
		entry = strings.ToLower(entry)
		if strings.HasPrefix(entry, ".") {
			return strings.HasSuffix(host, entry)
		}
		return host == entry
	})
}

func bytesReader(b []byte) io.Reader { return bytes.NewReader(b) }
