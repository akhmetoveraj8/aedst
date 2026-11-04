package push

import (
	"context"
	"crypto/ecdh"
	"crypto/rand"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"sync/atomic"
	"testing"
	"time"
)

func TestIsPublicAddr(t *testing.T) {
	cases := map[string]bool{
		"142.250.74.106":           true, // a public (Google) address
		"2a00:1450:4001:82a::200a": true,
		"127.0.0.1":                false,
		"::1":                      false,
		"10.1.2.3":                 false,
		"172.16.0.1":               false,
		"192.168.1.1":              false,
		"169.254.169.254":          false, // cloud metadata
		"fd00:ec2::254":            false, // AWS IPv6 metadata
		"100.64.0.1":               false, // CGNAT
		"0.0.0.0":                  false,
		"::":                       false,
		"::ffff:127.0.0.1":         false, // IPv4-mapped loopback
		"64:ff9b::a00:1":           false, // NAT64 of 10.0.0.1
		"64:ff9b::8efa:4a6a":       true,  // NAT64 of a public address
		"fe80::1":                  false,
		"224.0.0.1":                false,
		"255.255.255.255":          false,
		"198.18.0.1":               false,
	}
	for in, want := range cases {
		if got := isPublicAddr(netip.MustParseAddr(in)); got != want {
			t.Errorf("isPublicAddr(%s) = %v, want %v", in, got, want)
		}
	}
}

// The dial-time guard sees the resolved address, so a host name that resolves
// to loopback (or a rebinding DNS answer) is refused like the literal is.
func TestWebPushHTTPClient_RefusesNonPublicAddresses(t *testing.T) {
	var hits atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { hits.Add(1) }))
	defer srv.Close()
	client := NewWebPushHTTPClient(2 * time.Second)
	_, port, _ := net.SplitHostPort(srv.Listener.Addr().String())

	for _, target := range []string{srv.URL, "http://localhost:" + port} {
		req, _ := http.NewRequestWithContext(context.Background(), http.MethodPost, target, nil)
		resp, err := client.Do(req)
		if err == nil {
			_ = resp.Body.Close()
		}
		if !errors.Is(err, ErrBlockedAddress) {
			t.Errorf("POST %s: err = %v, want ErrBlockedAddress", target, err)
		}
	}
	if hits.Load() != 0 {
		t.Fatalf("a blocked address was reached %d times", hits.Load())
	}
}

// A blocked endpoint never becomes reachable: Send reports it as an invalid
// token so the device is deactivated instead of retried.
func TestWebPush_BlockedEndpointDeactivates(t *testing.T) {
	cfg, _ := newVAPID(t)
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusCreated) }))
	defer srv.Close()
	wp, err := NewWebPush(cfg, NewWebPushHTTPClient(2*time.Second))
	if err != nil {
		t.Fatal(err)
	}
	ua, _ := ecdh.P256().GenerateKey(rand.Reader)
	err = wp.Send(context.Background(), Target{Endpoint: srv.URL, P256dh: b64(ua.PublicKey().Bytes()), Auth: b64(make([]byte, 16))}, Message{Title: "x"})
	if !errors.Is(err, ErrInvalidToken) || !errors.Is(err, ErrBlockedAddress) {
		t.Fatalf("err = %v, want ErrInvalidToken wrapping ErrBlockedAddress", err)
	}
}

// A push service answers 201; a redirect is returned as is, never followed (it
// could point anywhere, including an internal address).
func TestWebPushHTTPClient_DoesNotFollowRedirects(t *testing.T) {
	var followed atomic.Int32
	target := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { followed.Add(1) }))
	defer target.Close()
	redirector := httptest.NewServer(http.RedirectHandler(target.URL, http.StatusTemporaryRedirect))
	defer redirector.Close()

	client := newWebPushHTTPClient(2*time.Second, nil) // no address guard: both servers are on loopback
	req, _ := http.NewRequestWithContext(context.Background(), http.MethodPost, redirector.URL, nil)
	resp, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusTemporaryRedirect || followed.Load() != 0 {
		t.Fatalf("status = %d, redirect target hit %d times; want 307 and 0", resp.StatusCode, followed.Load())
	}
	if classify("web push", resp.StatusCode, "") == nil {
		t.Error("a redirect was classified as a successful delivery")
	}
}
