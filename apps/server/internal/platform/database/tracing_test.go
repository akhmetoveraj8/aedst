package database

import (
	"context"
	"testing"

	"go.opentelemetry.io/otel/sdk/trace/tracetest"

	sdktrace "go.opentelemetry.io/otel/sdk/trace"
)

func TestParentOnlyProvider_NoRootSpans(t *testing.T) {
	rec := tracetest.NewSpanRecorder()
	tp := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(rec), sdktrace.WithSampler(sdktrace.AlwaysSample()))
	tracer := parentOnlyProvider{inner: tp}.Tracer("pgx")

	// A background statement (no parent span) must not create a trace.
	_, span := tracer.Start(context.Background(), "SELECT river_job")
	span.End()
	if n := len(rec.Ended()); n != 0 {
		t.Fatalf("a parentless statement recorded %d span(s), want 0", n)
	}

	// A statement inside a request span is a child span.
	ctx, parent := tp.Tracer("http").Start(context.Background(), "POST /x")
	_, child := tracer.Start(ctx, "SELECT tasks")
	child.End()
	parent.End()
	ended := rec.Ended()
	if len(ended) != 2 {
		t.Fatalf("recorded %d spans, want parent + child", len(ended))
	}
	if ended[0].Parent().SpanID() != ended[1].SpanContext().SpanID() {
		t.Fatal("the statement span must be a child of the request span")
	}
}
