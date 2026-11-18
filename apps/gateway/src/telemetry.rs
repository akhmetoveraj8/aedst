//! Logging and OpenTelemetry. JSON logs always; traces are exported over OTLP/HTTP only when
//! `OTEL_EXPORTER_OTLP_ENDPOINT` (or the traces variant) is set, with the standard `OTEL_*`
//! variables read by the SDK itself, like the Go server.

use opentelemetry::trace::TracerProvider as _;
use opentelemetry_sdk::Resource;
use opentelemetry_sdk::trace::SdkTracerProvider;
use tracing_subscriber::EnvFilter;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;

const SERVICE_NAME: &str = "aedst-gateway";

/// Keeps the tracer provider alive; call [`Telemetry::shutdown`] to flush on exit.
pub struct Telemetry {
    provider: Option<SdkTracerProvider>,
}

impl Telemetry {
    /// Installs the global subscriber. A failure to set up the exporter is logged and the gateway
    /// runs without traces: telemetry must never stop the service.
    #[must_use]
    pub fn init() -> Self {
        let filter = EnvFilter::try_from_env("AEDST_LOG_LEVEL").unwrap_or_else(|_| EnvFilter::new("info"));
        let registry = tracing_subscriber::registry().with(filter).with(tracing_subscriber::fmt::layer().json());

        let exporting = ["OTEL_EXPORTER_OTLP_ENDPOINT", "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT"]
            .iter()
            .any(|key| std::env::var(key).is_ok_and(|v| !v.trim().is_empty()));
        let mut setup_error = None;
        let provider = if exporting {
            match build_provider() {
                Ok(provider) => Some(provider),
                Err(error) => {
                    setup_error = Some(error);
                    None
                }
            }
        } else {
            None
        };
        match &provider {
            Some(provider) => {
                opentelemetry::global::set_tracer_provider(provider.clone());
                let layer = tracing_opentelemetry::layer().with_tracer(provider.tracer(SERVICE_NAME));
                registry.with(layer).init();
            }
            None => registry.init(),
        }
        if let Some(error) = setup_error {
            tracing::warn!(%error, "trace export disabled");
        }
        Self { provider }
    }

    /// Flushes pending spans.
    pub fn shutdown(self) {
        if let Some(provider) = self.provider
            && let Err(error) = provider.shutdown()
        {
            tracing::warn!(%error, "trace flush failed");
        }
    }
}

fn build_provider() -> Result<SdkTracerProvider, String> {
    let exporter = opentelemetry_otlp::SpanExporter::builder().with_http().build().map_err(|e| e.to_string())?;
    Ok(SdkTracerProvider::builder()
        .with_batch_exporter(exporter)
        .with_resource(Resource::builder().with_service_name(SERVICE_NAME).build())
        .build())
}
