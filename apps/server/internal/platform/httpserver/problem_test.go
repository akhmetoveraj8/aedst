package httpserver_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/aedst/server/internal/platform/httpserver"
)

// problemOf asserts rec is an RFC 9457 document and returns its members.
func problemOf(t *testing.T, rec *httptest.ResponseRecorder, status int) map[string]any {
	t.Helper()
	if rec.Code != status {
		t.Fatalf("status = %d, want %d", rec.Code, status)
	}
	if got := rec.Header().Get("Content-Type"); got != httpserver.ProblemContentType {
		t.Fatalf("Content-Type = %q, want %q", got, httpserver.ProblemContentType)
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("body is not JSON: %v (%s)", err, rec.Body)
	}
	if got, ok := body["status"].(float64); !ok || int(got) != status {
		t.Fatalf(`"status" = %v, want %d`, body["status"], status)
	}
	for _, member := range []string{"type", "title"} {
		if s, ok := body[member].(string); !ok || s == "" {
			t.Fatalf("member %q missing in %v", member, body)
		}
	}
	return body
}

func TestWriteProblem_MembersAndReservedNames(t *testing.T) {
	rec := httptest.NewRecorder()
	httpserver.WriteProblem(rec, httptest.NewRequest(http.MethodPost, "/hooks/x?secret=1", nil), httpserver.Problem{
		Status: http.StatusConflict, Detail: "already delivered", Code: "DUPLICATE",
		Extensions: map[string]any{"event_id": "e1", "status": "spoofed", "instance": "spoofed"},
	})
	body := problemOf(t, rec, http.StatusConflict)
	want := map[string]any{
		"type": "about:blank", "title": "Conflict", "detail": "already delivered",
		"code": "DUPLICATE", "instance": "/hooks/x", "event_id": "e1",
	}
	for k, v := range want {
		if body[k] != v {
			t.Errorf("%s = %v, want %v", k, body[k], v)
		}
	}
	if rec.Header().Get("Cache-Control") != "no-store" {
		t.Error("a problem document must not be cached")
	}

	rec = httptest.NewRecorder()
	httpserver.WriteProblem(rec, nil, httpserver.Problem{Type: "https://docs.example/problems/x", Title: "X"})
	body = problemOf(t, rec, http.StatusInternalServerError)
	if body["type"] != "https://docs.example/problems/x" || body["title"] != "X" {
		t.Errorf("explicit type/title lost: %v", body)
	}
	if _, has := body["detail"]; has {
		t.Error("empty detail must be omitted")
	}
}

func TestRouter_PlainHTTPErrorsAreProblemDocuments(t *testing.T) {
	router := httpserver.NewRouter(httpserver.Options{Logger: discardLogger(), MaxBodyBytes: 16, RequestTimeout: 20 * time.Millisecond})
	router.HandleFunc("POST /echo", func(http.ResponseWriter, *http.Request) {})
	router.HandleFunc("GET /panic", func(http.ResponseWriter, *http.Request) { panic("boom") })
	router.HandleFunc("GET /slow", func(_ http.ResponseWriter, r *http.Request) { <-r.Context().Done() })

	tests := []struct {
		name   string
		req    *http.Request
		status int
		code   string
	}{
		{"unknown path", httptest.NewRequest(http.MethodGet, "/nope", nil), http.StatusNotFound, "NOT_FOUND"},
		{"wrong method", httptest.NewRequest(http.MethodGet, "/echo", nil), http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED"},
		{"oversize body", httptest.NewRequest(http.MethodPost, "/echo", strings.NewReader(strings.Repeat("x", 17))), http.StatusRequestEntityTooLarge, "BODY_TOO_LARGE"},
		{"panic", httptest.NewRequest(http.MethodGet, "/panic", nil), http.StatusInternalServerError, "INTERNAL"},
		{"timeout", httptest.NewRequest(http.MethodGet, "/slow", nil), http.StatusGatewayTimeout, "REQUEST_TIMEOUT"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, tt.req)
			body := problemOf(t, rec, tt.status)
			if body["code"] != tt.code {
				t.Errorf("code = %v, want %s", body["code"], tt.code)
			}
			if body["instance"] != tt.req.URL.Path {
				t.Errorf("instance = %v, want %s", body["instance"], tt.req.URL.Path)
			}
			if strings.Contains(rec.Body.String(), "boom") {
				t.Error("the panic value leaked to the client")
			}
		})
	}

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/echo", nil))
	if allow := rec.Header().Get("Allow"); !strings.Contains(allow, http.MethodPost) {
		t.Errorf("405 lost the mux's Allow header: %q", allow)
	}
}

func TestReadiness_NotReadyIsAProblemDocument(t *testing.T) {
	r := httpserver.NewReadiness(httpserver.Check{Name: "postgres", Fn: func(context.Context) error { return errors.New("down") }}).WithCacheTTL(0)
	rec := httptest.NewRecorder()
	r.Handler()(rec, httptest.NewRequest(http.MethodGet, "/readyz", nil))
	body := problemOf(t, rec, http.StatusServiceUnavailable)
	if body["code"] != "DEPENDENCY_UNAVAILABLE" {
		t.Errorf("code = %v", body["code"])
	}
	if failed, _ := body["failed"].([]any); len(failed) != 1 || failed[0] != "postgres" {
		t.Errorf("failed = %v, want [postgres]", body["failed"])
	}

	r.SetDraining()
	rec = httptest.NewRecorder()
	r.Handler()(rec, httptest.NewRequest(http.MethodGet, "/readyz", nil))
	if body := problemOf(t, rec, http.StatusServiceUnavailable); body["code"] != "DRAINING" {
		t.Errorf("code = %v, want DRAINING", body["code"])
	}
}
