package httpserver_test

import (
	"context"
	"crypto/tls"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect/v2"

	platformauth "github.com/aedst/server/internal/platform/auth"
	"github.com/aedst/server/internal/platform/httpserver"
)

func TestRouter_HardeningHeaders(t *testing.T) {
	router := httpserver.NewRouter(httpserver.Options{Logger: discardLogger(), HSTSMaxAge: 365 * 24 * time.Hour, TrustedProxyHops: 1})

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/livez", nil))
	for header, want := range map[string]string{
		"X-Frame-Options":            "DENY",
		"Cross-Origin-Opener-Policy": "same-origin",
	} {
		if got := rec.Header().Get(header); got != want {
			t.Errorf("%s = %q, want %q", header, got, want)
		}
	}
	if pp := rec.Header().Get("Permissions-Policy"); !strings.Contains(pp, "camera=()") {
		t.Errorf("Permissions-Policy = %q", pp)
	}
	if hsts := rec.Header().Get("Strict-Transport-Security"); hsts != "" {
		t.Errorf("HSTS over plain HTTP = %q, want none (browsers ignore it and it would mislead)", hsts)
	}

	req := httptest.NewRequest(http.MethodGet, "/livez", nil)
	req.Header.Set("X-Forwarded-Proto", "https")
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if hsts := rec.Header().Get("Strict-Transport-Security"); hsts != "max-age=31536000; includeSubDomains" {
		t.Errorf("HSTS behind a trusted TLS proxy = %q", hsts)
	}

	// Without trusted proxies a client-supplied X-Forwarded-Proto is ignored.
	untrusted := httpserver.NewRouter(httpserver.Options{Logger: discardLogger(), HSTSMaxAge: time.Hour})
	rec = httptest.NewRecorder()
	untrusted.ServeHTTP(rec, req)
	if hsts := rec.Header().Get("Strict-Transport-Security"); hsts != "" {
		t.Errorf("spoofed X-Forwarded-Proto produced HSTS %q", hsts)
	}
}

func TestRouter_CORSNeverAllowsCredentials(t *testing.T) {
	router := httpserver.NewRouter(httpserver.Options{Logger: discardLogger(), AllowedOrigins: []string{"https://app.example.com"}})
	router.HandleFunc("POST /x", func(w http.ResponseWriter, _ *http.Request) {})

	preflight := func(origin string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodOptions, "/x", nil)
		req.Header.Set("Origin", origin)
		req.Header.Set("Access-Control-Request-Method", http.MethodPost)
		req.Header.Set("Access-Control-Request-Headers", "connect-protocol-version,content-type")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		return rec
	}
	ok := preflight("https://app.example.com")
	if ok.Header().Get("Access-Control-Allow-Origin") != "https://app.example.com" {
		t.Fatalf("allowed origin not echoed: %v", ok.Header())
	}
	if ok.Header().Get("Access-Control-Allow-Credentials") != "" {
		t.Error("credentials must never be allowed cross-origin")
	}
	if evil := preflight("https://evil.example.com"); evil.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Errorf("unlisted origin allowed: %v", evil.Header())
	}
}

func TestRouter_MaxBodyBytes(t *testing.T) {
	router := httpserver.NewRouter(httpserver.Options{Logger: discardLogger(), MaxBodyBytes: 16})
	var readErr error
	router.HandleFunc("POST /echo", func(w http.ResponseWriter, r *http.Request) {
		_, readErr = io.ReadAll(r.Body)
	})

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/echo", strings.NewReader(strings.Repeat("x", 17))))
	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Errorf("declared oversize body: status %d, want 413", rec.Code)
	}

	// Chunked (no Content-Length): cut off while reading.
	req := httptest.NewRequest(http.MethodPost, "/echo", io.MultiReader(strings.NewReader(strings.Repeat("x", 64))))
	req.ContentLength = -1
	router.ServeHTTP(httptest.NewRecorder(), req)
	if readErr == nil {
		t.Error("an undeclared oversize body was read in full")
	}
}

// A streaming procedure must outlive the server's WriteTimeout and the
// router's RequestTimeout; a unary one must not.
func TestStreamingProceduresEscapeUnaryDeadlines(t *testing.T) {
	const streamPath = "/test.v1.Svc/Watch"
	router := httpserver.NewRouter(httpserver.Options{
		Logger:              discardLogger(),
		RequestTimeout:      50 * time.Millisecond,
		StreamingProcedures: map[string]bool{streamPath: true},
	})
	handler := func(w http.ResponseWriter, r *http.Request) {
		for range 4 {
			select {
			case <-r.Context().Done():
				return
			case <-time.After(60 * time.Millisecond):
			}
			_, _ = w.Write([]byte("tick\n"))
			http.NewResponseController(w).Flush()
		}
	}
	router.HandleFunc("GET "+streamPath, handler)
	router.HandleFunc("GET /unary", handler)

	srv := httptest.NewUnstartedServer(router)
	srv.Config.WriteTimeout = 100 * time.Millisecond
	srv.Start()
	defer srv.Close()

	resp, err := srv.Client().Get(srv.URL + streamPath)
	if err != nil {
		t.Fatal(err)
	}
	body, err := io.ReadAll(resp.Body)
	_ = resp.Body.Close()
	if err != nil || strings.Count(string(body), "tick") != 4 {
		t.Errorf("stream got %q, %v; want 4 ticks past the write timeout", body, err)
	}

	resp, err = srv.Client().Get(srv.URL + "/unary")
	if err == nil {
		body, _ = io.ReadAll(resp.Body)
		_ = resp.Body.Close()
	}
	if err == nil && strings.Count(string(body), "tick") == 4 {
		t.Error("a unary request escaped the request timeout")
	}
}

func TestNewWithConfig_LimitsAndTLS(t *testing.T) {
	plain := httpserver.NewWithConfig(httpserver.ServerConfig{Addr: ":0"}, http.NotFoundHandler(), discardLogger()).HTTPServer()
	if plain.ReadHeaderTimeout == 0 || plain.ReadTimeout == 0 || plain.WriteTimeout == 0 || plain.IdleTimeout == 0 || plain.MaxHeaderBytes == 0 {
		t.Errorf("defaults not applied: %+v", plain)
	}
	if plain.TLSConfig != nil || !plain.Protocols.UnencryptedHTTP2() {
		t.Error("without a certificate the server must speak h2c, not TLS")
	}
	custom := httpserver.NewWithConfig(httpserver.ServerConfig{Addr: ":0", MaxHeaderBytes: 8 << 10, WriteTimeout: time.Second, TLSCertFile: "c", TLSKeyFile: "k"}, http.NotFoundHandler(), discardLogger()).HTTPServer()
	if custom.MaxHeaderBytes != 8<<10 || custom.WriteTimeout != time.Second {
		t.Errorf("overrides not applied: %+v", custom)
	}
	if custom.TLSConfig == nil || custom.TLSConfig.MinVersion < tls.VersionTLS12 || !custom.Protocols.HTTP2() {
		t.Error("TLS must require at least TLS 1.2 and offer HTTP/2")
	}
}

func TestRoleInterceptor_ServiceWildcard(t *testing.T) {
	policy := httpserver.MergeRolePolicy(
		map[string][]string{"/test.v1.Svc/*": {"admin"}},
		map[string][]string{},
	)
	call := serve(t, func(context.Context) error { return nil },
		withIdentity(platformauth.Identity{Roles: []string{"user"}}), httpserver.RoleInterceptor(policy))
	if err := call(); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("err = %v, want PermissionDenied from the service wildcard", err)
	}
	// An exact entry overrides the wildcard.
	policy = httpserver.MergeRolePolicy(map[string][]string{"/test.v1.Svc/*": {"admin"}}, map[string][]string{testProcedure: {"user"}})
	call = serve(t, func(context.Context) error { return nil },
		withIdentity(platformauth.Identity{Roles: []string{"user"}}), httpserver.RoleInterceptor(policy))
	if err := call(); err != nil {
		t.Fatalf("exact entry should win: %v", err)
	}
}

func TestValidateRolePolicy_Wildcards(t *testing.T) {
	known := map[string]bool{"/a.v1.Admin/List": true, "/a.v1.Auth/Login": true}
	public := map[string]bool{"/a.v1.Auth/Login": true}
	if err := httpserver.ValidateRolePolicy(map[string][]string{"/a.v1.Admin/*": {"admin"}}, known, public); err != nil {
		t.Fatalf("valid wildcard rejected: %v", err)
	}
	if err := httpserver.ValidateRolePolicy(map[string][]string{"/a.v1.Admn/*": {"admin"}}, known, public); err == nil {
		t.Error("a wildcard matching nothing must fail")
	}
	if err := httpserver.ValidateRolePolicy(map[string][]string{"/a.v1.Auth/*": {"admin"}}, known, public); err == nil {
		t.Error("a wildcard covering a public procedure must fail")
	}
}
