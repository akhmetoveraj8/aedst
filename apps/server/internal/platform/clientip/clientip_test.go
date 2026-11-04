package clientip_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/aedst/server/internal/platform/clientip"
)

func resolve(t *testing.T, hops int, remote string, xff ...string) string {
	t.Helper()
	var got string
	h := clientip.Middleware(hops)(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		got = clientip.FromContext(r.Context())
	}))
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = remote
	for _, v := range xff {
		req.Header.Add("X-Forwarded-For", v)
	}
	req.Header.Set("X-Real-IP", "6.6.6.6")
	h.ServeHTTP(httptest.NewRecorder(), req)
	return got
}

func TestWithoutProxiesHeadersAreIgnored(t *testing.T) {
	if got := resolve(t, 0, "203.0.113.9:5000", "1.2.3.4"); got != "203.0.113.9" {
		t.Fatalf("ip = %q, want the socket peer", got)
	}
}

func TestTrustedHopsCountFromTheRight(t *testing.T) {
	// The client forged the leftmost entry; our one trusted proxy appended the real one.
	if got := resolve(t, 1, "10.0.0.1:1", "9.9.9.9, 198.51.100.7"); got != "198.51.100.7" {
		t.Fatalf("1 hop: ip = %q, want the rightmost entry", got)
	}
	if got := resolve(t, 2, "10.0.0.1:1", "9.9.9.9, 198.51.100.7, 10.0.0.2"); got != "198.51.100.7" {
		t.Fatalf("2 hops: ip = %q, want the 2nd from the right", got)
	}
	if got := resolve(t, 2, "10.0.0.1:1", "198.51.100.7"); got != "" {
		t.Fatalf("misconfigured hops: ip = %q, want empty", got)
	}
}
