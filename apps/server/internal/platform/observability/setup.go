package observability

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"go.opentelemetry.io/contrib/bridges/otelslog"
	"go.opentelemetry.io/contrib/exporters/autoexport"
	"go.opentelemetry.io/contrib/instrumentation/runtime"
	"go.opentelemetry.io/otel"
	otelprom "go.opentelemetry.io/otel/exporters/prometheus"
	"go.opentelemetry.io/otel/propagation"
	sdklog "go.opentelemetry.io/otel/sdk/log"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.26.0"
)

// Config configures telemetry.
type Config struct {
	ServiceName string
	LogLevel    string
	LogFormat   string
	// ExportEnabled turns on OTLP export of traces, metrics and logs. The
	// destination, protocol, headers, sampling and resource attributes come
	// from the standard OTEL_* environment variables read by the SDK, so any
	// OTLP backend (Grafana Cloud, SigNoz, HyperDX, otel-lgtm, a Collector)
	// works without code changes. When false, telemetry is still created and
	// propagated in-process; nothing is exported.
	ExportEnabled bool
}

// Telemetry owns the process-wide OpenTelemetry providers and the logger.
type Telemetry struct {
	// Logger is the process logger: JSON/text on stdout, plus OTLP when
	// export is enabled. Every record carries trace_id/span_id/request_id.
	Logger *slog.Logger
	// MetricsHandler serves the Prometheus exposition of the same OTel
	// metrics, for optional pull-based scraping (AEDST_METRICS_ADDR).
	MetricsHandler http.Handler

	shutdowns []func(context.Context) error
}

// Shutdown flushes and stops every provider; call it last on exit.
func (t *Telemetry) Shutdown(ctx context.Context) error {
	var errs []error
	for i := len(t.shutdowns) - 1; i >= 0; i-- {
		errs = append(errs, t.shutdowns[i](ctx))
	}
	return errors.Join(errs...)
}

// Setup installs the global OpenTelemetry tracer/meter providers and
// propagators and builds the process logger.
func Setup(ctx context.Context, cfg Config) (*Telemetry, error) {
	tel := &Telemetry{}

	res, err := resource.New(ctx,
		resource.WithAttributes(semconv.ServiceName(cfg.ServiceName)),
		resource.WithFromEnv(), // OTEL_SERVICE_NAME / OTEL_RESOURCE_ATTRIBUTES override the above
		resource.WithTelemetrySDK(),
		resource.WithProcess(),
		resource.WithHost(),
	)
	if err != nil {
		return nil, fmt.Errorf("observability: build resource: %w", err)
	}

	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(
		propagation.TraceContext{},
		propagation.Baggage{},
	))

	// --- traces ---
	traceOpts := []sdktrace.TracerProviderOption{sdktrace.WithResource(res)}
	if cfg.ExportEnabled {
		exporter, err := autoexport.NewSpanExporter(ctx)
		if err != nil {
			return nil, fmt.Errorf("observability: span exporter: %w", err)
		}
		traceOpts = append(traceOpts, sdktrace.WithBatcher(exporter))
	}
	tp := sdktrace.NewTracerProvider(traceOpts...)
	otel.SetTracerProvider(tp)
	tel.shutdowns = append(tel.shutdowns, tp.Shutdown)

	// --- metrics: one instrumentation, two outputs (OTLP push + Prometheus pull) ---
	registry := prometheus.NewRegistry()
	promReader, err := otelprom.New(otelprom.WithRegisterer(registry))
	if err != nil {
		return nil, fmt.Errorf("observability: prometheus exporter: %w", err)
	}
	meterOpts := []sdkmetric.Option{sdkmetric.WithResource(res), sdkmetric.WithReader(promReader)}
	if cfg.ExportEnabled {
		reader, err := autoexport.NewMetricReader(ctx)
		if err != nil {
			return nil, fmt.Errorf("observability: metric reader: %w", err)
		}
		meterOpts = append(meterOpts, sdkmetric.WithReader(reader))
	}
	mp := sdkmetric.NewMeterProvider(meterOpts...)
	otel.SetMeterProvider(mp)
	tel.shutdowns = append(tel.shutdowns, mp.Shutdown)
	if err := runtime.Start(); err != nil {
		return nil, fmt.Errorf("observability: runtime metrics: %w", err)
	}
	tel.MetricsHandler = promhttp.HandlerFor(registry, promhttp.HandlerOpts{})

	// --- logs ---
	var extra []slog.Handler
	if cfg.ExportEnabled {
		exporter, err := autoexport.NewLogExporter(ctx)
		if err != nil {
			return nil, fmt.Errorf("observability: log exporter: %w", err)
		}
		lp := sdklog.NewLoggerProvider(
			sdklog.WithResource(res),
			sdklog.WithProcessor(sdklog.NewBatchProcessor(exporter)),
		)
		tel.shutdowns = append(tel.shutdowns, lp.Shutdown)
		extra = append(extra, otelslog.NewHandler(cfg.ServiceName, otelslog.WithLoggerProvider(lp)))
	}
	tel.Logger = NewLogger(cfg.LogLevel, cfg.LogFormat, cfg.ServiceName, extra...)

	return tel, nil
}
