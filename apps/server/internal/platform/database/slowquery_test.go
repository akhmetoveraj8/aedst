package database

import (
	"bytes"
	"context"
	"log/slog"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/multitracer"
	"github.com/jackc/pgx/v5/pgxpool"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"

	sdktrace "go.opentelemetry.io/otel/sdk/trace"
)

// captureLogs swaps the default logger for the test.
func captureLogs(t *testing.T) *bytes.Buffer {
	t.Helper()
	var buf bytes.Buffer
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&buf, nil)))
	t.Cleanup(func() { slog.SetDefault(prev) })
	return &buf
}

func TestSlowQueryTracer_ReportsOnlyStatementsOverTheThreshold(t *testing.T) {
	logs := captureLogs(t)
	rec := tracetest.NewSpanRecorder()
	tp := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(rec))
	ctx, span := tp.Tracer("test").Start(context.Background(), "SELECT tasks")

	const secret = "alice@example.com"
	sql := "-- name: GetTaskStats :one\nSELECT count(*) FROM tasks.tasks WHERE user_id = $1" + strings.Repeat(" ", 400)

	fast := newSlowQueryTracer(time.Hour, "api")
	fast.TraceQueryEnd(fast.TraceQueryStart(ctx, nil, pgx.TraceQueryStartData{SQL: sql, Args: []any{secret}}), nil, pgx.TraceQueryEndData{})
	if logs.Len() != 0 {
		t.Fatalf("a statement under the threshold was reported: %s", logs)
	}

	slow := newSlowQueryTracer(time.Nanosecond, "api")
	started := slow.TraceQueryStart(ctx, nil, pgx.TraceQueryStartData{SQL: sql, Args: []any{secret}})
	time.Sleep(time.Millisecond)
	slow.TraceQueryEnd(started, nil, pgx.TraceQueryEndData{})
	span.End()

	line := logs.String()
	for _, want := range []string{`"level":"WARN"`, `"msg":"database: slow query"`, `"pool":"api"`, "GetTaskStats", `"duration_ms"`} {
		if !strings.Contains(line, want) {
			t.Fatalf("log line lacks %s: %s", want, line)
		}
	}
	if strings.Contains(line, secret) {
		t.Fatalf("query arguments must never be logged: %s", line)
	}
	if len(line) > maxLoggedStatement+400 {
		t.Fatalf("log line is %d bytes: the statement must be truncated", len(line))
	}
	events := rec.Ended()[0].Events()
	if len(events) != 1 || events[0].Name != "db.slow_query" {
		t.Fatalf("span events = %+v, want one db.slow_query", events)
	}
}

func TestSlowQueryTracer_EndWithoutStartIsIgnored(t *testing.T) {
	logs := captureLogs(t)
	newSlowQueryTracer(time.Nanosecond, "api").TraceQueryEnd(context.Background(), nil, pgx.TraceQueryEndData{})
	if logs.Len() != 0 {
		t.Fatalf("unexpected report: %s", logs)
	}
}

func TestApplyTracer_SlowQueryReportingIsOptional(t *testing.T) {
	cfg, err := pgxpool.ParseConfig("postgres://u:p@localhost:5432/db")
	if err != nil {
		t.Fatal(err)
	}
	otelTracer := newTracer()
	applyTracer(cfg, otelTracer, 0, "api")
	if cfg.ConnConfig.Tracer != pgx.QueryTracer(otelTracer) {
		t.Fatalf("threshold 0 must install otelpgx alone, got %T", cfg.ConnConfig.Tracer)
	}
	applyTracer(cfg, otelTracer, 500*time.Millisecond, "api")
	multi, ok := cfg.ConnConfig.Tracer.(*multitracer.Tracer)
	if !ok {
		t.Fatalf("a threshold must combine both tracers, got %T", cfg.ConnConfig.Tracer)
	}
	// Order matters: the slow-query tracer must end before otelpgx ends the span.
	if _, first := multi.QueryTracers[0].(*slowQueryTracer); !first || len(multi.QueryTracers) != 2 {
		t.Fatalf("query tracers = %T, want the slow-query tracer first, then otelpgx", multi.QueryTracers)
	}
	// otelpgx also traces batches, prepares, connects and pool acquires; the
	// combination must keep those.
	if len(multi.BatchTracers) != 1 || len(multi.PrepareTracers) != 1 || len(multi.ConnectTracers) != 1 || len(multi.PoolAcquireTracers) != 1 {
		t.Fatalf("multitracer dropped an otelpgx hook: %+v", multi)
	}
}
