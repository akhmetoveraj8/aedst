package httpserver_test

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connecthttp"
	"google.golang.org/protobuf/types/known/emptypb"
	"google.golang.org/protobuf/types/known/wrapperspb"

	capabilitiesv1 "github.com/aedst/server/gen/go/aedst/capabilities/v1"
	tasksv1 "github.com/aedst/server/gen/go/aedst/tasks/v1"
	"github.com/aedst/server/internal/platform/httpserver"
)

const (
	cachedProcedure   = "/test.v1.Svc/GetCached"
	uncachedProcedure = "/test.v1.Svc/GetPrivate"
	getQuery          = "?connect=v1&encoding=json&message=%7B%7D"
)

// cacheRouter serves two side-effect-free reads through the real router (so its
// default "Cache-Control: no-store" is in play); only cachedProcedure has a policy.
func cacheRouter(t *testing.T, value *string, calls *int, extra ...connect.ServerInterceptor) *httptest.Server {
	t.Helper()
	policies := map[string]httpserver.CachePolicy{
		cachedProcedure: {MaxAge: 5 * time.Minute, Shared: true, Vary: []string{httpserver.ClientHeader}},
	}
	server := connect.NewServer(append([]connect.ServerInterceptor{httpserver.ConditionalReadInterceptor(policies)}, extra...)...)
	for _, procedure := range []string{cachedProcedure, uncachedProcedure} {
		server.Register(connect.Method{
			Spec: connect.Spec{Procedure: procedure, StreamType: connect.StreamTypeUnary, IdempotencyLevel: connect.IdempotencyNoSideEffects},
			Handler: func(_ context.Context, _ connect.Spec, stream connect.ServerStream) error {
				if err := stream.Receive(&emptypb.Empty{}); err != nil {
					return err
				}
				*calls++
				return stream.Send(wrapperspb.String(*value))
			},
		})
	}
	router := httpserver.NewRouter(httpserver.Options{Logger: discardLogger()})
	connecthttp.Mount(router.ServeMux, server)
	srv := httptest.NewServer(router)
	t.Cleanup(srv.Close)
	return srv
}

// httpResult is the part of a response the tests read (the body is already closed).
type httpResult struct {
	StatusCode int
	Header     http.Header
}

// fetch performs one request and returns its status, headers and body.
func fetch(t *testing.T, srv *httptest.Server, method, path string, header map[string]string) (httpResult, string) {
	t.Helper()
	var body io.Reader
	if method == http.MethodPost {
		body = strings.NewReader("{}")
	}
	req, err := http.NewRequestWithContext(context.Background(), method, srv.URL+path, body)
	if err != nil {
		t.Fatal(err)
	}
	if method == http.MethodPost {
		req.Header.Set("Content-Type", "application/json")
	}
	for k, v := range header {
		req.Header.Set(k, v)
	}
	resp, err := srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()
	data, _ := io.ReadAll(resp.Body)
	return httpResult{StatusCode: resp.StatusCode, Header: resp.Header}, string(data)
}

func TestConditionalRead_ETagCacheControlAnd304(t *testing.T) {
	value, calls := "v1", 0
	srv := cacheRouter(t, &value, &calls)

	first, body := fetch(t, srv, http.MethodGet, cachedProcedure+getQuery, nil)
	etag := first.Header.Get("ETag")
	if first.StatusCode != http.StatusOK || !strings.Contains(body, "v1") {
		t.Fatalf("GET = %d %q", first.StatusCode, body)
	}
	if !strings.HasPrefix(etag, `"`) {
		t.Fatalf("ETag = %q, want a strong entity tag", etag)
	}
	if got := first.Header.Values("Cache-Control"); len(got) != 1 || got[0] != "public, max-age=300" {
		t.Fatalf("Cache-Control = %q, want exactly the policy (no-store replaced)", got)
	}
	vary := strings.Join(first.Header.Values("Vary"), ", ")
	for _, want := range []string{"Accept-Encoding", httpserver.ClientHeader} {
		if !strings.Contains(vary, want) {
			t.Errorf("Vary = %q, want it to contain %s", vary, want)
		}
	}

	for _, ifNoneMatch := range []string{etag, "W/" + etag, `"other", ` + etag, "*"} {
		resp, body := fetch(t, srv, http.MethodGet, cachedProcedure+getQuery, map[string]string{"If-None-Match": ifNoneMatch})
		if resp.StatusCode != http.StatusNotModified || body != "" {
			t.Fatalf("If-None-Match %q = %d %q, want 304 with no body", ifNoneMatch, resp.StatusCode, body)
		}
		if resp.Header.Get("ETag") != etag || resp.Header.Get("Cache-Control") != "public, max-age=300" {
			t.Errorf("304 lost its validators: ETag %q Cache-Control %q", resp.Header.Get("ETag"), resp.Header.Get("Cache-Control"))
		}
	}

	// The resource changed: the old tag no longer matches and a new one is issued.
	value = "v2"
	changed, body := fetch(t, srv, http.MethodGet, cachedProcedure+getQuery, map[string]string{"If-None-Match": etag})
	if changed.StatusCode != http.StatusOK || !strings.Contains(body, "v2") || changed.Header.Get("ETag") == etag {
		t.Fatalf("after a change: %d %q ETag %q (old %q)", changed.StatusCode, body, changed.Header.Get("ETag"), etag)
	}

	// Another representation of the same message has another strong tag.
	proto, _ := fetch(t, srv, http.MethodGet, cachedProcedure+"?connect=v1&encoding=proto&message=", nil)
	if proto.StatusCode != http.StatusOK || proto.Header.Get("ETag") == changed.Header.Get("ETag") {
		t.Errorf("proto encoding: status %d, ETag %q must differ from the JSON one", proto.StatusCode, proto.Header.Get("ETag"))
	}
}

func TestConditionalRead_EverythingElseStaysNoStore(t *testing.T) {
	value, calls := "v1", 0
	srv := cacheRouter(t, &value, &calls)

	unmarked, _ := fetch(t, srv, http.MethodGet, uncachedProcedure+getQuery, nil)
	post, _ := fetch(t, srv, http.MethodPost, cachedProcedure, map[string]string{"If-None-Match": "*"})
	for name, resp := range map[string]httpResult{"unmarked GET": unmarked, "POST of a cacheable read": post} {
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("%s: status %d", name, resp.StatusCode)
		}
		if resp.Header.Get("Cache-Control") != "no-store" || resp.Header.Get("ETag") != "" {
			t.Errorf("%s: Cache-Control %q ETag %q, want no-store and no ETag", name, resp.Header.Get("Cache-Control"), resp.Header.Get("ETag"))
		}
	}
}

// A failing call (here: refused by an inner interceptor, as auth or a limiter
// would) is never answered 304 or made cacheable, whatever If-None-Match says.
func TestConditionalRead_ErrorsAreNeverCachedOrNotModified(t *testing.T) {
	value, calls := "v1", 0
	deny := func(connect.ServerFunc) connect.ServerFunc {
		return func(context.Context, connect.Spec, connect.ServerStream) error {
			return connect.NewError(connect.CodePermissionDenied, "no")
		}
	}
	srv := cacheRouter(t, &value, &calls, deny)
	resp, _ := fetch(t, srv, http.MethodGet, cachedProcedure+getQuery, map[string]string{"If-None-Match": "*"})
	if resp.StatusCode != http.StatusForbidden || resp.Header.Get("Cache-Control") != "no-store" || resp.Header.Get("ETag") != "" {
		t.Fatalf("denied call = %d Cache-Control %q ETag %q", resp.StatusCode, resp.Header.Get("Cache-Control"), resp.Header.Get("ETag"))
	}
	if calls != 0 {
		t.Fatal("the handler ran behind a refusing interceptor")
	}
}

func TestValidateCachePolicy(t *testing.T) {
	const capabilities = "/aedst.capabilities.v1.CapabilitiesService/GetCapabilities"
	capabilitiesFile, tasksFile := capabilitiesv1.File_aedst_capabilities_v1_capabilities_proto, tasksv1.File_aedst_tasks_v1_tasks_proto
	public := map[string]bool{capabilities: true}
	valid := map[string]httpserver.CachePolicy{capabilities: {MaxAge: time.Minute, Shared: true}}
	if err := httpserver.ValidateCachePolicy(valid, public, capabilitiesFile); err != nil {
		t.Fatalf("the reference policy was rejected: %v", err)
	}

	tests := []struct {
		name   string
		policy map[string]httpserver.CachePolicy
		public map[string]bool
		want   string
	}{
		{"unknown procedure", map[string]httpserver.CachePolicy{"/aedst.capabilities.v1.CapabilitiesService/Nope": {MaxAge: time.Minute}}, public, "unknown procedure"},
		{"RPC with side effects", map[string]httpserver.CachePolicy{"/aedst.tasks.v1.TasksService/CreateTask": {MaxAge: time.Minute}}, public, "NO_SIDE_EFFECTS"},
		{"no max-age", map[string]httpserver.CachePolicy{capabilities: {Shared: true}}, public, "MaxAge"},
		{"shared cache for an authenticated procedure", valid, map[string]bool{}, "only for procedures reachable without a token"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := httpserver.ValidateCachePolicy(tt.policy, tt.public, capabilitiesFile, tasksFile)
			if err == nil || !strings.Contains(err.Error(), tt.want) {
				t.Fatalf("err = %v, want it to mention %q", err, tt.want)
			}
		})
	}
}
