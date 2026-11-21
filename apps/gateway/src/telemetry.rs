//! Logging and OpenTelemetry. JSON logs always; traces and metrics are exported over OTLP/HTTP only
//! when `OTEL_EXPORTER_OTLP_ENDPOINT` (or a signal-specific variant) is set, with the standard
//! `OTEL_*` variables read by the SDK itself, like the Go server. Without an endpoint the
//! instruments (`consumer.rs`) record nothing.

use opentelemetry::trace::TracerProvider as _;
use opentelemetry_sdk::Resource;
use opentelemetry_sdk::metrics::SdkMeterProvider;
use opentelemetry_sdk::trace::SdkTracerProvider;
use tracing_subscriber::EnvFilter;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;

const SERVICE_NAME: &str = "aedst-gateway";
const ENDPOINT_VARIABLES: [&str; 3] = [
    "OTEL_EXPORTER_OTLP_ENDPOINT",
    "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
    "OTEL_EXPORTER_OTLP_METRICS_ENDPOINT",
];

/// Keeps the providers alive; call [`Telemetry::shutdown`] to flush on exit.
pub struct Telemetry {
    tracer: Option<SdkTracerProvider>,
    meter: Option<SdkMeterProvider>,
}

impl Telemetry {
    /// Installs the global subscriber. A failure to set up an exporter is logged and the gateway
    /// runs without it: telemetry must never stop the service.
    #[must_use]
    pub fn init() -> Self {
        let filter =
            EnvFilter::try_from_env("AEDST_LOG_LEVEL").unwrap_or_else(|_| EnvFilter::new("info"));
        let registry = tracing_subscriber::registry()
            .with(filter)
            .with(tracing_subscriber::fmt::layer().json());

        let exporting = ENDPOINT_VARIABLES
            .iter()
            .any(|key| std::env::var(key).is_ok_and(|v| !v.trim().is_empty()));
        let (tracer, tracer_error) = match exporting.then(build_tracer_provider) {
            Some(Ok(provider)) => (Some(provider), None),
            Some(Err(error)) => (None, Some(error)),
            None => (None, None),
        };
        let (meter, meter_error) = match exporting.then(build_meter_provider) {
            Some(Ok(provider)) => (Some(provider), None),
            Some(Err(error)) => (None, Some(error)),
            None => (None, None),
        };
        match &tracer {
            Some(provider) => {
                opentelemetry::global::set_tracer_provider(provider.clone());
                let layer =
                    tracing_opentelemetry::layer().with_tracer(provider.tracer(SERVICE_NAME));
                registry.with(layer).init();
            }
            None => registry.init(),
        }
        if let Some(provider) = &meter {
            opentelemetry::global::set_meter_provider(provider.clone());
        }
        if let Some(error) = tracer_error {
            tracing::warn!(%error, "trace export disabled");
        }
        if let Some(error) = meter_error {
            tracing::warn!(%error, "metric export disabled");
        }
        Self { tracer, meter }
    }

    /// Flushes pending spans and metrics.
    pub fn shutdown(self) {
        if let Some(provider) = self.tracer
            && let Err(error) = provider.shutdown()
        {
            tracing::warn!(%error, "trace flush failed");
        }
        if let Some(provider) = self.meter
            && let Err(error) = provider.shutdown()
        {
            tracing::warn!(%error, "metric flush failed");
        }
    }
}

fn resource() -> Resource {
    Resource::builder().with_service_name(SERVICE_NAME).build()
}

fn build_tracer_provider() -> Result<SdkTracerProvider, String> {
    let exporter = opentelemetry_otlp::SpanExporter::builder()
        .with_http()
        .build()
        .map_err(|e| e.to_string())?;
    Ok(SdkTracerProvider::builder()
        .with_batch_exporter(exporter)
        .with_resource(resource())
        .build())
}

fn build_meter_provider() -> Result<SdkMeterProvider, String> {
    let exporter = opentelemetry_otlp::MetricExporter::builder()
        .with_http()
        .build()
        .map_err(|e| e.to_string())?;
    Ok(SdkMeterProvider::builder()
        .with_periodic_exporter(exporter)
        .with_resource(resource())
        .build())
}
