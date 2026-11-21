package httpserver

import (
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// Security model of the HTTP edge (see also README "Security"):
//
//   - TLS: terminated at the edge by default (ingress / load balancer / CDN);
//     in-process TLS (min 1.2) is available via AEDST_TLS_CERT_FILE/KEY_FILE.
//   - CSRF: the API authenticates ONLY with an Authorization bearer token and
//     never reads cookies, so a cross-site request carries no ambient
//     credentials and CSRF does not apply. As defense in depth every Connect
//     handler requires the Connect-Protocol-Version header
//     (connect.WithRequireConnectProtocolHeader, see the RPC mounter in
//     cmd/server), which a plain HTML form or a "simple" cross-origin request
//     cannot send without a CORS preflight. The web app reaches the API
//     through its same-origin BFF, so browsers do not call it cross-origin.
//   - CORS: an explicit origin allow-list (AEDST_CORS_ALLOWED_ORIGINS), never
//     credentials, "*" rejected in staging/production.
//   - Limits: per-request body cap (MaxBodyBytes), per-service message caps,
//     header size/timeouts on the http.Server, load shedding (MaxInFlight) and
//     per-user / per-IP rate limits in the interceptor chain.

// securityHeaders sets the response headers that make sense for an API that
// never serves documents: no sniffing, no framing, nothing cacheable, no
// referrer leakage, no powerful browser features, and HSTS on HTTPS.
func securityHeaders(hstsMaxAge time.Duration, trustForwardedProto bool) func(http.Handler) http.Handler {
	hsts := ""
	if hstsMaxAge > 0 {
		hsts = "max-age=" + strconv.FormatInt(int64(hstsMaxAge.Seconds()), 10) + "; includeSubDomains"
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			h := w.Header()
			h.Set("X-Content-Type-Options", "nosniff")
			h.Set("X-Frame-Options", "DENY")
			h.Set("Cache-Control", "no-store")
			h.Set("Referrer-Policy", "no-referrer")
			h.Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'")
			h.Set("Permissions-Policy", "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=(), interest-cohort=()")
			h.Set("Cross-Origin-Opener-Policy", "same-origin")
			if hsts != "" && isHTTPS(r, trustForwardedProto) {
				h.Set("Strict-Transport-Security", hsts)
			}
			next.ServeHTTP(&cacheDefaultWriter{ResponseWriter: w}, r)
		})
	}
}

// cacheDefaultWriter makes "Cache-Control: no-store" a default instead of a
// second header: Connect adds response headers to the ones already set, so a
// cacheable read (ConditionalReadInterceptor) would otherwise answer both
// "no-store" and its own policy. When the handler added a Cache-Control, the
// default set by securityHeaders is dropped just before the header is written.
// Unwrap keeps http.ResponseController (Flush, deadlines) working.
type cacheDefaultWriter struct {
	http.ResponseWriter
	resolved bool
}

func (w *cacheDefaultWriter) resolve() {
	if w.resolved {
		return
	}
	w.resolved = true
	if values := w.Header().Values("Cache-Control"); len(values) > 1 && values[0] == "no-store" {
		w.Header()["Cache-Control"] = values[1:]
	}
}

func (w *cacheDefaultWriter) WriteHeader(code int) {
	if code >= 200 || code == http.StatusSwitchingProtocols {
		w.resolve()
	}
	w.ResponseWriter.WriteHeader(code)
}

func (w *cacheDefaultWriter) Write(b []byte) (int, error) {
	w.resolve()
	return w.ResponseWriter.Write(b)
}

func (w *cacheDefaultWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }

func isHTTPS(r *http.Request, trustForwardedProto bool) bool {
	if r.TLS != nil {
		return true
	}
	return trustForwardedProto && strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https")
}

// maxBodyBytes rejects bodies larger than limit before anything reads them:
// a declared Content-Length over the limit is answered 413 immediately, and
// an undeclared (chunked) body is cut off by http.MaxBytesReader.
func maxBodyBytes(limit int64) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.ContentLength > limit {
				WriteProblem(w, r, Problem{Status: http.StatusRequestEntityTooLarge, Code: "BODY_TOO_LARGE", Detail: "request body too large"})
				return
			}
			r.Body = http.MaxBytesReader(w, r.Body, limit)
			next.ServeHTTP(w, r)
		})
	}
}

// streamingDeadlines clears the server-wide write (and read) deadline for
// streaming procedures, so http.Server.WriteTimeout can stay sized for unary
// calls without cutting long-lived streams. Unary requests are untouched.
func streamingDeadlines(streaming map[string]bool, logger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if streaming[r.URL.Path] {
				rc := http.NewResponseController(w)
				for _, err := range []error{rc.SetWriteDeadline(time.Time{}), rc.SetReadDeadline(time.Time{})} {
					if err != nil && !errors.Is(err, http.ErrNotSupported) && logger != nil {
						logger.WarnContext(r.Context(), "streaming: cannot clear deadline", slog.Any("error", err))
					}
				}
			}
			next.ServeHTTP(w, r)
		})
	}
}

// skipPaths applies mw to every request except those whose path is in paths.
func skipPaths(paths map[string]bool, mw func(http.Handler) http.Handler) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		guarded := mw(next)
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if paths[r.URL.Path] {
				next.ServeHTTP(w, r)
				return
			}
			guarded.ServeHTTP(w, r)
		})
	}
}
