package observability_test

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"net/http/httptest"
	"strings"
	"testing"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/trace"

	"github.com/aedst/server/internal/platform/observability"
)

func decode(t *testing.T, buf *bytes.Buffer) map[string]any {
	t.Helper()
	var rec map[string]any
	if err := json.Unmarshal(bytes.TrimSpace(buf.Bytes()), &rec); err != nil {
		t.Fatalf("log line %q is not JSON: %v", buf.String(), err)
	}
	return rec
}

// Correlation ids are attached by the handler, so no call site has to
// remember them — the property that makes a log line findable from a trace.
func TestLogger_AttachesCorrelationFromContext(t *testing.T) {
	var buf bytes.Buffer
	logger := observability.NewLoggerTo(&buf, "info", "json", "svc")

	ctx := observability.WithRequestID(context.Background(), "req-1")
	ctx = observability.WithUserID(ctx, "user-1")
	traceID, _ := trace.TraceIDFromHex("0123456789abcdef0123456789abcdef")
	spanID, _ := trace.SpanIDFromHex("0123456789abcdef")
	ctx = trace.ContextWithSpanContext(ctx, trace.NewSpanContext(trace.SpanContextConfig{TraceID: traceID, SpanID: spanID, TraceFlags: trace.FlagsSampled}))

	logger.InfoContext(ctx, "hello", slog.String("k", "v"))
	rec := decode(t, &buf)
	for key, want := range map[string]string{
		"service": "svc", "msg": "hello", "k": "v", "request_id": "req-1", "user_id": "user-1",
		"trace_id": "0123456789abcdef0123456789abcdef", "span_id": "0123456789abcdef",
	} {
		if rec[key] != want {
			t.Errorf("%s = %v, want %q (record %v)", key, rec[key], want, rec)
		}
	}

	buf.Reset()
	logger.Info("no context")
	rec = decode(t, &buf)
	for _, key := range []string{"request_id", "user_id", "trace_id"} {
		if _, ok := rec[key]; ok {
			t.Errorf("%s present without a context carrying it", key)
		}
	}
}

func TestLogger_LevelFormatAndDerivedLoggers(t *testing.T) {
	var buf bytes.Buffer
	logger := observability.NewLoggerTo(&buf, "warn", "json", "svc")
	logger.Info("dropped")
	if buf.Len() != 0 {
		t.Fatalf("info was logged at level warn: %s", buf.String())
	}
	logger.With("component", "x").WithGroup("g").Warn("kept", "a", 1)
	rec := decode(t, &buf)
	if rec["component"] != "x" || rec["g"].(map[string]any)["a"] != float64(1) {
		t.Errorf("With/WithGroup lost attributes: %v", rec)
	}

	buf.Reset()
	observability.NewLoggerTo(&buf, "not-a-level", "text", "svc").Info("fallback")
	if !strings.Contains(buf.String(), "level=INFO") || !strings.Contains(buf.String(), "msg=fallback") {
		t.Errorf("an unknown level must fall back to info, text format: %q", buf.String())
	}
}

// Setup with export disabled still produces working, in-process telemetry: a
// logger, and one Prometheus exposition carrying both runtime and custom OTel
// metrics — the "one instrumentation, two outputs" contract.
func TestSetup_ExposesOTelMetricsOnThePrometheusHandler(t *testing.T) {
	ctx := context.Background()
	tel, err := observability.Setup(ctx, observability.Config{ServiceName: "svc-test", LogLevel: "info", LogFormat: "json"})
	if err != nil {
		t.Fatalf("Setup: %v", err)
	}
	t.Cleanup(func() { _ = tel.Shutdown(context.Background()) })

	counter, err := otel.Meter("test").Int64Counter("aedst_test_events_total")
	if err != nil {
		t.Fatal(err)
	}
	counter.Add(ctx, 3)

	rec := httptest.NewRecorder()
	tel.MetricsHandler.ServeHTTP(rec, httptest.NewRequest("GET", "/metrics", nil))
	body := rec.Body.String()
	for _, want := range []string{"aedst_test_events_total", "go_goroutine_count", "go_memory_used_bytes"} {
		if !strings.Contains(body, want) {
			t.Errorf("/metrics lacks %q", want)
		}
	}
	if tel.Logger == nil {
		t.Fatal("Setup returned no logger")
	}
	if err := tel.Shutdown(ctx); err != nil {
		t.Errorf("Shutdown: %v", err)
	}
}
