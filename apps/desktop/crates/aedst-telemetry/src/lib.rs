//! Observability for the desktop app: one PII scrubber, consent, redacted file logging, crash reports
//! and analytics (events go to the project's own server, never to a third party). Behaviour follows `apps/desktop/docs/adr/0030-observability-privacy.md`.
//!
//! Nothing leaves the machine without consent, and crash reports and analytics are separate opt-ins
//! that are OFF by default. The scrubber is used on every path out of the process.

pub mod analytics;
pub mod consent;
pub mod crash;
pub mod logging;
pub mod scrub;

pub use analytics::{
    Analytics, AnalyticsSink, BufferedTransport, EventCatalog, EventTransport, NoopSink,
    OutgoingEvent,
};
pub use consent::{
    Consent, ConsentError, ConsentState, ConsentStore, KvConsentStore, MemoryConsentStore,
};
pub use crash::{CrashConfig, CrashReporter, CrashStatus, Environment};
pub use logging::{LogGuard, LoggingConfig, init_logging};
pub use scrub::{scrub_json, scrub_pii};
