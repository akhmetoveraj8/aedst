package database

import (
	"context"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
	"go.opentelemetry.io/otel/trace"
)

const (
	slowQueryCounter = "aedst_db_slow_queries"
	// maxLoggedStatement keeps a log line bounded; sqlc statements start with
	// their "-- name:" comment, so the head identifies the query.
	maxLoggedStatement = 300
)

// slowQueryTracer is a pgx QueryTracer that reports statements that take at
// least threshold: a warning log line (with the request's trace id), an event
// on the statement's span and a counter. It records the statement text and its
// duration, never the arguments. It complements the log_min_duration_statement
// setting of Postgres: this side knows the trace and the pool.
//
// It measures what the caller waited for one Query/Exec round trip, so it
// includes network time and, for Query, only the time until rows start to
// arrive.
type slowQueryTracer struct {
	threshold time.Duration
	pool      string
	slow      metric.Int64Counter
}

func newSlowQueryTracer(threshold time.Duration, pool string) *slowQueryTracer {
	t := &slowQueryTracer{threshold: threshold, pool: pool}
	// A nil counter (instrument creation failed) only loses the metric.
	t.slow, _ = otel.Meter("github.com/aedst/server/internal/platform/database").Int64Counter(slowQueryCounter,
		metric.WithDescription("Statements that took at least AEDST_DATABASE_SLOW_QUERY_MS, by pool."))
	return t
}

type slowQueryKey struct{}

type slowQueryStart struct {
	at  time.Time
	sql string
}

func (t *slowQueryTracer) TraceQueryStart(ctx context.Context, _ *pgx.Conn, data pgx.TraceQueryStartData) context.Context {
	return context.WithValue(ctx, slowQueryKey{}, slowQueryStart{at: time.Now(), sql: data.SQL})
}

func (t *slowQueryTracer) TraceQueryEnd(ctx context.Context, _ *pgx.Conn, _ pgx.TraceQueryEndData) {
	start, ok := ctx.Value(slowQueryKey{}).(slowQueryStart)
	if !ok {
		return
	}
	if elapsed := time.Since(start.at); elapsed >= t.threshold {
		t.report(ctx, start.sql, elapsed)
	}
}

func (t *slowQueryTracer) report(ctx context.Context, statement string, elapsed time.Duration) {
	if len(statement) > maxLoggedStatement {
		statement = statement[:maxLoggedStatement]
	}
	if t.slow != nil {
		t.slow.Add(ctx, 1, metric.WithAttributes(attribute.String("pool", t.pool)))
	}
	trace.SpanFromContext(ctx).AddEvent("db.slow_query", trace.WithAttributes(
		attribute.Int64("db.slow_query.duration_ms", elapsed.Milliseconds()),
		attribute.Int64("db.slow_query.threshold_ms", t.threshold.Milliseconds()),
	))
	slog.WarnContext(ctx, "database: slow query",
		slog.String("pool", t.pool),
		slog.Int64("duration_ms", elapsed.Milliseconds()),
		slog.Int64("threshold_ms", t.threshold.Milliseconds()),
		slog.String("statement", statement))
}
