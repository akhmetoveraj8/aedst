// Package httpserver builds the net/http ServeMux router and the small, deliberately short
// middleware stack every request goes through (CORS, request ID, logging,
// panic recovery, timeout) plus the ConnectRPC interceptors (auth, rate
// limiting). Tracing and HTTP metrics come from OpenTelemetry
// (otelhttp/otelconnect, see Instrument), not hand-rolled middleware.
// Modules mount ConnectRPC handlers onto the router this package builds;
// they never construct their own HTTP server.
package httpserver

import (
	"context"
	"log/slog"
	"net/http"
	"regexp"
	"runtime/debug"
	"time"
	"uuid"

	"github.com/rs/cors"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"

	"github.com/aedst/server/internal/platform/clientip"
	"github.com/aedst/server/internal/platform/observability"
)

// Options configures the router's middleware stack.
type Options struct {
	Logger         *slog.Logger
	RequestTimeout time.Duration
	// AllowedOrigins are the browser origins permitted to call the API
	// cross-origin (see config.HTTPConfig.AllowedOrigins). A Connect-ES web
	// client (e.g. apps/web) is on a different origin in local dev, so this
	// must be set or every browser call fails CORS preflight.
	AllowedOrigins []string
	// TrustedProxyHops is the exact number of trusted reverse proxies in front
	// of this server; the client IP is then read from X-Forwarded-For. 0 uses
	// the socket peer address (see package clientip; spoofable headers such as
	// X-Real-IP or the leftmost X-Forwarded-For entry are never trusted).
	TrustedProxyHops int
	// Readiness backs /readyz. Optional; without it /readyz always reports
	// ready.
	Readiness *Readiness
	// MaxInFlight caps concurrently processing requests (probes excluded); the
	// excess is shed immediately with 429 + Retry-After instead of queueing
	// until the whole instance drowns. 0 disables shedding.
	MaxInFlight int
	// MaxBodyBytes caps every request body at the HTTP layer
	// (http.MaxBytesReader), before any decoding. Per-service message limits
	// (connect.WithReadMaxBytes) are applied on top by the RPC mounter.
	// 0 disables.
	MaxBodyBytes int64
	// HSTSMaxAge, when positive, sends Strict-Transport-Security on requests
	// that arrived over HTTPS (directly, or per X-Forwarded-Proto from a
	// trusted proxy when TrustedProxyHops > 0).
	HSTSMaxAge time.Duration
	// StreamingProcedures are exempt from RequestTimeout and from the server's
	// WriteTimeout (cleared per request through http.ResponseController), so
	// a long-lived stream is not cut off by limits sized for unary calls.
	StreamingProcedures map[string]bool
}

// Router is a net/http ServeMux wrapped in the standard middleware stack.
// Register routes with Handle/HandleFunc using Go 1.22+ patterns
// ("GET /livez", "/pkg.Service/"); every request, including ones the mux
// answers with 404/405, passes through the middleware.
type Router struct {
	*http.ServeMux
	handler http.Handler
}

// ServeHTTP runs the middleware stack, then the mux.
func (r *Router) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	r.handler.ServeHTTP(w, req)
}

// NewRouter builds the base router with the standard middleware stack
// applied.
func NewRouter(opts Options) *Router {
	mux := http.NewServeMux()

	// Outermost first.
	stack := []func(http.Handler) http.Handler{
		corsMiddleware(opts.AllowedOrigins),
		securityHeaders(opts.HSTSMaxAge, opts.TrustedProxyHops > 0),
		requestIDMiddleware,
		clientip.Middleware(opts.TrustedProxyHops),
		loggingMiddleware(opts.Logger),
		recoveryMiddleware(opts.Logger),
	}
	if opts.MaxInFlight > 0 {
		stack = append(stack, skipProbes(loadShedding(opts.MaxInFlight)))
	}
	if opts.MaxBodyBytes > 0 {
		stack = append(stack, maxBodyBytes(opts.MaxBodyBytes))
	}
	stack = append(stack, streamingDeadlines(opts.StreamingProcedures, opts.Logger))
	if opts.RequestTimeout > 0 {
		stack = append(stack, skipPaths(opts.StreamingProcedures, requestTimeout(opts.RequestTimeout)))
	}

	// Liveness: the process is up and serving, nothing more. No dependency
	// checks here, so a database outage does not make an orchestrator
	// restart otherwise-healthy instances.
	mux.HandleFunc("GET /livez", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	// Readiness: dependencies reachable and not draining; gates traffic.
	mux.Handle("GET /readyz", opts.Readiness.Handler())

	var h http.Handler = mux
	for i := len(stack) - 1; i >= 0; i-- {
		h = stack[i](h)
	}
	return &Router{ServeMux: mux, handler: h}
}

// loadShedding caps concurrently processing requests at limit and sheds the
// excess immediately with 429 + Retry-After instead of queueing. Custom code
// is justified: neither the standard library nor any library in the approved
// stack does load shedding (http.TimeoutHandler and rate limiters do not bound
// concurrency).
func loadShedding(limit int) func(http.Handler) http.Handler {
	slots := make(chan struct{}, limit)
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			select {
			case slots <- struct{}{}:
				defer func() { <-slots }()
				next.ServeHTTP(w, r)
			default:
				w.Header().Set("Retry-After", "1")
				http.Error(w, "server busy, retry shortly", http.StatusTooManyRequests)
			}
		})
	}
}

// requestTimeout bounds each request with a context deadline. It is not
// http.TimeoutHandler: that buffers the whole response and breaks Flush and
// http.ResponseController, which Connect relies on. If the handler returns
// after the deadline without having written anything, the client gets 504.
func requestTimeout(d time.Duration) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ctx, cancel := context.WithTimeout(r.Context(), d)
			sw := &statusWriter{ResponseWriter: w}
			defer func() {
				cancel()
				if ctx.Err() == context.DeadlineExceeded && !sw.wrote {
					w.WriteHeader(http.StatusGatewayTimeout)
				}
			}()
			next.ServeHTTP(sw, r.WithContext(ctx))
		})
	}
}

// statusWriter records the response status. Unwrap keeps
// http.ResponseController (Flush, SetWriteDeadline, ...) working through it.
type statusWriter struct {
	http.ResponseWriter
	status int
	wrote  bool
}

func (w *statusWriter) WriteHeader(code int) {
	// Informational 1xx responses (103 Early Hints) are not the final status.
	if code >= 100 && code < 200 && code != http.StatusSwitchingProtocols {
		w.ResponseWriter.WriteHeader(code)
		return
	}
	if !w.wrote {
		w.status, w.wrote = code, true
	}
	w.ResponseWriter.WriteHeader(code)
}

func (w *statusWriter) Write(b []byte) (int, error) {
	if !w.wrote {
		w.status, w.wrote = http.StatusOK, true
	}
	return w.ResponseWriter.Write(b)
}

func (w *statusWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }

// Status is the recorded status (200 when the handler wrote nothing).
func (w *statusWriter) Status() int {
	if !w.wrote {
		return http.StatusOK
	}
	return w.status
}

// Instrument wraps handler with OpenTelemetry HTTP server tracing and
// metrics. It must be the OUTERMOST wrapper so every middleware (and every
// log line) runs inside the request span. Probe endpoints are not traced.
func Instrument(handler http.Handler, serviceName string) http.Handler {
	return otelhttp.NewHandler(handler, serviceName,
		otelhttp.WithFilter(func(r *http.Request) bool { return r.URL.Path != "/livez" && r.URL.Path != "/readyz" }),
		// Span name is the method only: paths of unmatched requests are
		// attacker-controlled and would explode cardinality. RPC spans get
		// proper rpc.service/rpc.method names from otelconnect.
		otelhttp.WithSpanNameFormatter(func(_ string, r *http.Request) string { return r.Method }),
	)
}

// corsMiddleware allows a Connect-ES browser client on allowedOrigins to call
// this API cross-origin. Connect's unary protocol runs over plain HTTP
// POST+JSON (or protobuf), so it needs the usual CORS headers plus the
// Connect-specific ones a browser client sends; auth is a bearer token, not a
// cookie, so credentials aren't required.
func corsMiddleware(allowedOrigins []string) func(http.Handler) http.Handler {
	return cors.New(cors.Options{
		AllowedOrigins: allowedOrigins,
		AllowedMethods: []string{http.MethodGet, http.MethodPost, http.MethodOptions},
		AllowedHeaders: []string{
			"Content-Type",
			"Authorization",
			"Connect-Protocol-Version",
			"Connect-Timeout-Ms",
			"Connect-Content-Encoding",
			"Connect-Accept-Encoding",
			"Idempotency-Key",
			"X-Aedst-Client",
			"X-Request-Id",
			"X-Grpc-Web",
		},
		ExposedHeaders: []string{
			"Connect-Content-Encoding",
			"Connect-Accept-Encoding",
			"X-Request-Id",
		},
		// Bearer tokens only: browsers must never attach cookies or HTTP auth.
		AllowCredentials: false,
		MaxAge:           3600,
	}).Handler
}

// validRequestID accepts the shapes real clients send (UUIDs, ULIDs, short
// tokens) and rejects anything that could inject into logs or headers.
var validRequestID = regexp.MustCompile(`^[A-Za-z0-9._-]{1,64}$`)

func requestIDMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := r.Header.Get("X-Request-Id")
		if !validRequestID.MatchString(id) {
			id = uuid.NewV7().String()
		}
		w.Header().Set("X-Request-Id", id)
		ctx := observability.WithRequestID(r.Context(), id)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func recoveryMiddleware(logger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			defer func() { //nolint:contextcheck // recover handler runs in the request goroutine; r.Context() is used below
				rec := recover()
				if rec == nil {
					return
				}
				if rec == http.ErrAbortHandler { //nolint:errorlint // sentinel panic value, not an error chain
					panic(rec) // net/http's own "abort this response" signal
				}
				logger.ErrorContext(r.Context(), "panic recovered",
					slog.Any("panic", rec),
					slog.String("stack", string(debug.Stack())),
				)
				http.Error(w, "internal server error", http.StatusInternalServerError)
			}()
			next.ServeHTTP(w, r)
		})
	}
}

func loggingMiddleware(logger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			ww := &statusWriter{ResponseWriter: w}
			next.ServeHTTP(ww, r)
			if isProbe(r.URL.Path) {
				return // probes fire every few seconds; not worth a log line each
			}
			logger.InfoContext(r.Context(), "request",
				slog.String("method", r.Method),
				slog.String("path", r.URL.Path),
				slog.Int("status", ww.Status()),
				slog.Duration("duration", time.Since(start)),
			)
		})
	}
}

func isProbe(path string) bool { return path == "/livez" || path == "/readyz" }

// skipProbes applies mw to everything except the health probes: a saturated
// instance must still answer /livez and /readyz, or the orchestrator would
// restart (or stop routing to) exactly the instance that is shedding load
// correctly.
func skipProbes(mw func(http.Handler) http.Handler) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		guarded := mw(next)
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if isProbe(r.URL.Path) {
				next.ServeHTTP(w, r)
				return
			}
			guarded.ServeHTTP(w, r)
		})
	}
}
