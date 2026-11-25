// Package netguard is the one SSRF guard for outbound HTTP to user-supplied URLs (webhooks, Web Push).
//
// The check runs in net.Dialer.Control, on the literal IP the socket is about to connect to, after DNS
// resolution: a host name that resolves (or is re-bound) to a loopback, private, link-local, carrier-grade
// NAT, metadata or other special-purpose address is refused. Callers also disable environment proxies
// (through a proxy the dial would only see the proxy) and never follow redirects.
//
// Custom code is justified: the standard library has no "public addresses only" dialer and no module in
// go.mod provides one; the guard is net/netip predicates plus the IANA special-purpose registries.
package netguard

import (
	"errors"
	"fmt"
	"net/netip"
	"slices"
	"syscall"
)

// ErrNonPublicAddress is returned (wrapped) by Control when the destination is not a public unicast address.
var ErrNonPublicAddress = errors.New("netguard: destination is not a public address")

// nonPublic are special-purpose ranges the netip predicates do not cover
// (IANA IPv4 and IPv6 Special-Purpose Address Registries).
var nonPublic = []netip.Prefix{
	netip.MustParsePrefix("0.0.0.0/8"),       // "this network"
	netip.MustParsePrefix("100.64.0.0/10"),   // carrier-grade NAT (RFC 6598)
	netip.MustParsePrefix("192.0.0.0/24"),    // IETF protocol assignments
	netip.MustParsePrefix("192.0.2.0/24"),    // documentation (TEST-NET-1)
	netip.MustParsePrefix("198.18.0.0/15"),   // benchmarking
	netip.MustParsePrefix("198.51.100.0/24"), // documentation (TEST-NET-2)
	netip.MustParsePrefix("203.0.113.0/24"),  // documentation (TEST-NET-3)
	netip.MustParsePrefix("240.0.0.0/4"),     // reserved, incl. broadcast
	netip.MustParsePrefix("2001:db8::/32"),   // documentation
	netip.MustParsePrefix("100::/64"),        // discard-only
	netip.MustParsePrefix("2002::/16"),       // 6to4: embeds an IPv4 address that is not checked here
	netip.MustParsePrefix("2001::/32"),       // Teredo: tunnels to an embedded IPv4 address
}

// nat64 is the well-known NAT64 prefix: the IPv4 address in its last 32 bits is what is really reached,
// so that address is checked instead.
var nat64 = netip.MustParsePrefix("64:ff9b::/96")

// IsPublic reports whether addr is a public unicast address. The cloud metadata addresses are covered:
// 169.254.169.254 is link-local and fd00:ec2::254 is private (fc00::/7).
func IsPublic(addr netip.Addr) bool {
	addr = addr.Unmap()
	if nat64.Contains(addr) {
		b := addr.As16()
		addr = netip.AddrFrom4([4]byte{b[12], b[13], b[14], b[15]})
	}
	if !addr.IsValid() || addr.IsUnspecified() || addr.IsLoopback() || addr.IsPrivate() ||
		addr.IsLinkLocalUnicast() || addr.IsLinkLocalMulticast() || addr.IsInterfaceLocalMulticast() || addr.IsMulticast() {
		return false
	}
	return !slices.ContainsFunc(nonPublic, func(p netip.Prefix) bool { return p.Contains(addr) })
}

// Control is a net.Dialer.Control hook that refuses every non-public destination. address is the
// resolved "ip:port" about to be connected to.
func Control(_, address string, _ syscall.RawConn) error {
	ap, err := netip.ParseAddrPort(address)
	if err != nil {
		return fmt.Errorf("%w: %s", ErrNonPublicAddress, address)
	}
	if !IsPublic(ap.Addr()) {
		return fmt.Errorf("%w: %s", ErrNonPublicAddress, ap.Addr())
	}
	return nil
}
