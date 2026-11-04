// Package observability wires structured logging, tracing and metrics with
// consistent correlation (trace_id/request_id on every log line) — see
// the conventions in docs/content/server/architecture.md ("Observability").
package observability

import (
	"context"
	"io"
	"log/slog"
	"os"

	"go.opentelemetry.io/otel/trace"
)

type ctxKey int

const (
	requestIDKey ctxKey = iota
	userIDKey
)

// NewLogger builds the process-wide slog.Logger. Format/level come from
// config so the same binary logs human-readable text locally and structured
// JSON in every deployed environment.
func NewLogger(level, format, serviceName string, extra ...slog.Handler) *slog.Logger {
	return NewLoggerTo(os.Stdout, level, format, serviceName, extra...)
}

// NewLoggerTo is NewLogger writing to w (tests, or a non-stdout sink).
func NewLoggerTo(w io.Writer, level, format, serviceName string, extra ...slog.Handler) *slog.Logger {
	var lvl slog.Level
	if err := lvl.UnmarshalText([]byte(level)); err != nil {
		lvl = slog.LevelInfo
	}

	handlerOpts := &slog.HandlerOptions{Level: lvl}

	var handler slog.Handler
	if format == "text" {
		handler = slog.NewTextHandler(w, handlerOpts)
	} else {
		handler = slog.NewJSONHandler(w, handlerOpts)
	}

	root := slog.Handler(handler)
	if len(extra) > 0 {
		root = slog.NewMultiHandler(append([]slog.Handler{handler}, extra...)...)
	}

	return slog.New(&contextHandler{Handler: root}).With(
		slog.String("service", serviceName),
	)
}

// contextHandler injects request_id/trace_id/user_id from context into every
// log record, so a handler never has to remember to attach them manually.
type contextHandler struct {
	slog.Handler
}

func (h *contextHandler) Handle(ctx context.Context, r slog.Record) error {
	if id, ok := ctx.Value(requestIDKey).(string); ok && id != "" {
		r.AddAttrs(slog.String("request_id", id))
	}
	if sc := trace.SpanContextFromContext(ctx); sc.HasTraceID() {
		r.AddAttrs(slog.String("trace_id", sc.TraceID().String()), slog.String("span_id", sc.SpanID().String()))
	}
	if id, ok := ctx.Value(userIDKey).(string); ok && id != "" {
		r.AddAttrs(slog.String("user_id", id))
	}
	return h.Handler.Handle(ctx, r)
}

func (h *contextHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	return &contextHandler{Handler: h.Handler.WithAttrs(attrs)}
}

func (h *contextHandler) WithGroup(name string) slog.Handler {
	return &contextHandler{Handler: h.Handler.WithGroup(name)}
}

// WithRequestID returns a context carrying the request ID for log correlation.
func WithRequestID(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, requestIDKey, id)
}

// WithUserID returns a context carrying the authenticated user ID for log
// correlation.
func WithUserID(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, userIDKey, id)
}
