package netguard_test

import (
	"errors"
	"net/netip"
	"testing"

	"github.com/aedst/server/internal/platform/netguard"
)

func TestIsPublic(t *testing.T) {
	t.Parallel()
	cases := map[string]bool{
		"8.8.8.8":              true,
		"1.1.1.1":              true,
		"2606:4700::1111":      true,
		"64:ff9b::808:808":     true, // NAT64 of 8.8.8.8
		"127.0.0.1":            false,
		"10.1.2.3":             false,
		"172.16.0.1":           false,
		"192.168.1.1":          false,
		"169.254.169.254":      false, // cloud metadata
		"100.64.0.1":           false, // CGNAT
		"0.0.0.0":              false,
		"255.255.255.255":      false,
		"224.0.0.1":            false,
		"192.0.2.10":           false,
		"198.18.0.1":           false,
		"::1":                  false,
		"::":                   false,
		"fe80::1":              false,
		"fd00:ec2::254":        false, // AWS IPv6 metadata
		"::ffff:127.0.0.1":     false, // IPv4-mapped loopback
		"64:ff9b::7f00:1":      false, // NAT64 of 127.0.0.1
		"64:ff9b::a9fe:a9fe":   false, // NAT64 of 169.254.169.254
		"2001:db8::1":          false,
		"2002:7f00:1::":        false, // 6to4
		"2001:0:4136:e378::1":  false, // Teredo
		"100::1":               false,
		"ff02::1":              false,
		"192.0.0.8":            false,
		"203.0.113.7":          false,
		"198.51.100.200":       false,
		"240.0.0.1":            false,
		"2a00:1450:4001::200e": true,
	}
	for in, want := range cases {
		if got := netguard.IsPublic(netip.MustParseAddr(in)); got != want {
			t.Errorf("IsPublic(%s) = %v, want %v", in, got, want)
		}
	}
}

func TestControl(t *testing.T) {
	t.Parallel()
	if err := netguard.Control("tcp", "8.8.8.8:443", nil); err != nil {
		t.Fatalf("public address refused: %v", err)
	}
	for _, addr := range []string{"127.0.0.1:80", "[::1]:443", "169.254.169.254:80", "not-an-address"} {
		if err := netguard.Control("tcp", addr, nil); !errors.Is(err, netguard.ErrNonPublicAddress) {
			t.Errorf("Control(%s) = %v, want ErrNonPublicAddress", addr, err)
		}
	}
}
