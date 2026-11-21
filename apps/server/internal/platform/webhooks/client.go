package webhooks

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/netip"
	"slices"
	"strings"
	"syscall"
	"time"

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

// publicAddressOnly is the net.Dialer.Control hook: it sees the literal IP the
// socket is about to connect to.
func publicAddressOnly(_, address string, _ syscall.RawConn) error {
	addrPort, err := netip.ParseAddrPort(address)
	if err != nil {
		return fmt.Errorf("%w: %s", ErrForbiddenAddress, address)
	}
	if !IsPublicAddress(addrPort.Addr()) {
		return fmt.Errorf("%w: %s", ErrForbiddenAddress, addrPort.Addr())
	}
	return nil
}

// Ranges that are not global unicast but that the netip predicates do not cover.
var nonPublicPrefixes = []netip.Prefix{
	netip.MustParsePrefix("0.0.0.0/8"),       // "this network"
	netip.MustParsePrefix("100.64.0.0/10"),   // carrier-grade NAT (RFC 6598)
	netip.MustParsePrefix("192.0.0.0/24"),    // IETF protocol assignments
	netip.MustParsePrefix("192.0.2.0/24"),    // documentation
	netip.MustParsePrefix("198.18.0.0/15"),   // benchmarking
	netip.MustParsePrefix("198.51.100.0/24"), // documentation
	netip.MustParsePrefix("203.0.113.0/24"),  // documentation
	netip.MustParsePrefix("240.0.0.0/4"),     // reserved, broadcast
	netip.MustParsePrefix("64:ff9b::/96"),    // NAT64: maps to IPv4, checked there
	netip.MustParsePrefix("2001:db8::/32"),   // documentation
}

// IsPublicAddress reports whether addr is a public unicast address a webhook
// may be delivered to. The cloud metadata address 169.254.169.254 is link-local.
func IsPublicAddress(addr netip.Addr) bool {
	addr = addr.Unmap()
	if !addr.IsValid() || addr.IsUnspecified() || addr.IsLoopback() || addr.IsPrivate() ||
		addr.IsLinkLocalUnicast() || addr.IsLinkLocalMulticast() || addr.IsMulticast() || addr.IsInterfaceLocalMulticast() {
		return false
	}
	return !slices.ContainsFunc(nonPublicPrefixes, func(p netip.Prefix) bool { return p.Contains(addr) })
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
