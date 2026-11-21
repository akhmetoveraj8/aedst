package httpserver

import (
	"encoding/json"
	"maps"
	"net/http"
)

// ProblemContentType is the media type of an RFC 9457 problem document.
const ProblemContentType = "application/problem+json"

// Problem is an RFC 9457 "Problem Details for HTTP APIs" document: the one error
// body of every plain HTTP endpoint (health, load shedding, body limits, webhook
// intake). Connect RPCs do not use it: they answer Connect errors with codes and
// typed details (ToConnectError).
//
// Custom code is justified: the standard library has no problem-details encoder
// and no module in go.mod provides one; the document is five fixed members.
type Problem struct {
	// Type is a URI reference identifying the problem type; empty means "about:blank"
	// (the title is then the HTTP status text).
	Type string
	// Status is the HTTP status code; it is written to the response and the body.
	Status int
	// Title is a short, stable summary of the problem type. Empty: the status text.
	Title string
	// Detail explains this occurrence. Never put internal detail (driver errors,
	// paths, stack traces) here: it is sent to the client.
	Detail string
	// Code is a stable machine-readable reason in UPPER_SNAKE_CASE (extension member
	// "code"), the plain HTTP counterpart of ErrorInfo.reason on Connect errors.
	Code string
	// Extensions are further extension members. The reserved members (type, title,
	// status, detail, instance, code) cannot be overridden through it.
	Extensions map[string]any
}

// WriteProblem answers the request with p as application/problem+json. "instance"
// is the request path. It must be called before anything is written to w.
func WriteProblem(w http.ResponseWriter, r *http.Request, p Problem) {
	if p.Status == 0 {
		p.Status = http.StatusInternalServerError
	}
	body := map[string]any{}
	maps.Copy(body, p.Extensions)
	body["type"] = "about:blank"
	if p.Type != "" {
		body["type"] = p.Type
	}
	body["title"] = http.StatusText(p.Status)
	if p.Title != "" {
		body["title"] = p.Title
	}
	body["status"] = p.Status
	delete(body, "detail")
	if p.Detail != "" {
		body["detail"] = p.Detail
	}
	delete(body, "code")
	if p.Code != "" {
		body["code"] = p.Code
	}
	delete(body, "instance")
	if r != nil && r.URL != nil {
		body["instance"] = r.URL.Path
	}

	h := w.Header()
	h.Set("Content-Type", ProblemContentType)
	h.Set("Cache-Control", "no-store")
	h.Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(p.Status)
	// A map of JSON-encodable values chosen by this package cannot fail to encode;
	// a write error means the client went away.
	_ = json.NewEncoder(w).Encode(body)
}

// problemFallback answers the requests no route matches (the mux's own 404 and
// 405) as problem+json instead of the standard library's text body. The mux
// still decides the status and the Allow header: its handler runs against a
// writer that keeps the header and status and drops the text.
func problemFallback(mux *http.ServeMux) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		handler, pattern := mux.Handler(r)
		if pattern != "" {
			mux.ServeHTTP(w, r)
			return
		}
		probe := &statusOnlyWriter{header: w.Header(), status: http.StatusOK}
		handler.ServeHTTP(probe, r)
		code := "NOT_FOUND"
		if probe.status == http.StatusMethodNotAllowed {
			code = "METHOD_NOT_ALLOWED"
		}
		WriteProblem(w, r, Problem{Status: probe.status, Code: code})
	})
}

// statusOnlyWriter records the status a handler chose, shares the real header
// map and discards the body.
type statusOnlyWriter struct {
	header http.Header
	status int
}

func (w *statusOnlyWriter) Header() http.Header         { return w.header }
func (w *statusOnlyWriter) WriteHeader(status int)      { w.status = status }
func (w *statusOnlyWriter) Write(b []byte) (int, error) { return len(b), nil }
