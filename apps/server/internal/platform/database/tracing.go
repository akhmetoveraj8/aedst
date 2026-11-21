package database

import (
	"context"
	"time"

	"github.com/exaring/otelpgx"
	"github.com/jackc/pgx/v5/multitracer"
	"github.com/jackc/pgx/v5/pgxpool"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/trace"
	"go.opentelemetry.io/otel/trace/embedded"
)

// newTracer is the pgx QueryTracer of every pool (api, jobs, read): one span per
// statement, batch, prepare and connection acquire, named after the SQL
// operation (the otelpgx default) with the statement text but never its
// parameters.
//
// Spans are created only under an existing sampled-or-not parent. A request's
// statements join its trace; River's own polling and fetch queries, the pool
// health checks and the retention sweeps have no parent and would otherwise
// each become a root trace, flooding the backend with traces nobody reads.
// Work that matters in the background starts from a span (otelriver wraps each
// job), so its statements are traced.
func newTracer() *otelpgx.Tracer {
	return otelpgx.NewTracer(
		otelpgx.WithTracerProvider(parentOnlyProvider{inner: otel.GetTracerProvider()}),
	)
}

// applyTracer installs t on every connection of the pool (it also traces acquires via the pool tracer interface).
// With a slow-query threshold the two are combined by the multitracer that
// ships with pgx. The slow-query tracer goes first: multitracer runs End hooks
// in the same order as Start hooks, so it sees the statement span that otelpgx
// opened while that span is still recording.
func applyTracer(poolCfg *pgxpool.Config, t *otelpgx.Tracer, slowAfter time.Duration, pool string) {
	if slowAfter <= 0 {
		poolCfg.ConnConfig.Tracer = t
		return
	}
	poolCfg.ConnConfig.Tracer = multitracer.New(newSlowQueryTracer(slowAfter, pool), t)
}

// parentOnlyProvider hands out tracers that start a span only when the context
// already carries one.
type parentOnlyProvider struct {
	embedded.TracerProvider
	inner trace.TracerProvider
}

func (p parentOnlyProvider) Tracer(name string, opts ...trace.TracerOption) trace.Tracer {
	return parentOnlyTracer{inner: p.inner.Tracer(name, opts...)}
}

type parentOnlyTracer struct {
	embedded.Tracer
	inner trace.Tracer
}

func (t parentOnlyTracer) Start(ctx context.Context, name string, opts ...trace.SpanStartOption) (context.Context, trace.Span) {
	if !trace.SpanContextFromContext(ctx).IsValid() {
		return ctx, trace.SpanFromContext(ctx) // non-recording: otelpgx may call End/Set* on it safely
	}
	return t.inner.Start(ctx, name, opts...) //nolint:spancheck // delegating wrapper: the caller (otelpgx) ends the span
}
