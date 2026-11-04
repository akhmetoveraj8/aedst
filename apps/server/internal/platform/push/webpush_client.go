package push

import (
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"syscall"
	"time"

	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"

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

// guardPublicAddress is a net.Dialer Control hook: address is the resolved
// ip:port about to be connected to.
func guardPublicAddress(_, address string, _ syscall.RawConn) error {
	ap, err := netip.ParseAddrPort(address)
	if err != nil {
		return fmt.Errorf("%w: %s", ErrBlockedAddress, address)
	}
	if !isPublicAddr(ap.Addr()) {
		return fmt.Errorf("%w: %s", ErrBlockedAddress, ap.Addr())
	}
	return nil
}

// nonPublic are special-purpose ranges netip's predicates do not cover
// (IANA IPv4/IPv6 Special-Purpose Address Registries).
var nonPublic = []netip.Prefix{
	netip.MustParsePrefix("0.0.0.0/8"),       // "this network"
	netip.MustParsePrefix("100.64.0.0/10"),   // CGNAT (RFC 6598)
	netip.MustParsePrefix("192.0.0.0/24"),    // IETF protocol assignments
	netip.MustParsePrefix("192.0.2.0/24"),    // TEST-NET-1
	netip.MustParsePrefix("198.18.0.0/15"),   // benchmarking
	netip.MustParsePrefix("198.51.100.0/24"), // TEST-NET-2
	netip.MustParsePrefix("203.0.113.0/24"),  // TEST-NET-3
	netip.MustParsePrefix("240.0.0.0/4"),     // reserved, incl. broadcast
	netip.MustParsePrefix("2001:db8::/32"),   // documentation
	netip.MustParsePrefix("100::/64"),        // discard-only
}

// nat64 is the well-known NAT64 prefix: the IPv4 address embedded in its last
// 32 bits is what is really reached, so that is what is checked.
var nat64 = netip.MustParsePrefix("64:ff9b::/96")

func isPublicAddr(a netip.Addr) bool {
	a = a.Unmap()
	if nat64.Contains(a) {
		b := a.As16()
		a = netip.AddrFrom4([4]byte{b[12], b[13], b[14], b[15]})
	}
	// IsPrivate covers 10/8, 172.16/12, 192.168/16 and fc00::/7 (incl. the
	// fd00:ec2::254 metadata address); link-local covers 169.254.169.254.
	if !a.IsValid() || a.IsUnspecified() || a.IsLoopback() || a.IsPrivate() ||
		a.IsLinkLocalUnicast() || a.IsLinkLocalMulticast() || a.IsInterfaceLocalMulticast() || a.IsMulticast() {
		return false
	}
	for _, p := range nonPublic {
		if p.Contains(a) {
			return false
		}
	}
	return true
}
