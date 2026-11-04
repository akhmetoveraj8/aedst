//! Product analytics: consent-gated, allowlisted, scrubbed, anonymous.
//!
//! Features see only [`AnalyticsSink`]. [`Analytics`] is the real sink: it checks consent on every
//! call, accepts only events and properties of `docs/contract/analytics-events.json`, and hands the
//! result to an [`EventTransport`] ([`BufferedTransport`] until the server has an ingest endpoint, a recorder in tests). With
//! consent off the transport is never called, so no network request can start.
//!
//! # Adapting a feature's own analytics trait
//!
//! Features define their own small port (for example `TasksAnalytics`) so they need no dependency on
//! this crate. The shell adapts it; this is documentation, not code, so no feature crate is a
//! dependency here:
//!
//! ```text
//! struct TasksAnalyticsAdapter(Arc<dyn AnalyticsSink>);
//!
//! impl TasksAnalytics for TasksAnalyticsAdapter {
//!     fn task_created(&self, priority: &str, has_due_date: bool) {
//!         self.0.track("task_created", &props(json!({
//!             "priority": priority,
//!             "has_due_date": has_due_date,
//!         })));
//!     }
//! }
//! ```

mod buffer;
mod catalog;
mod install_id;

use std::sync::{Arc, Mutex, PoisonError};

use serde_json::{Map, Value};
use tokio::sync::watch;

pub use buffer::{BufferedTransport, DEFAULT_CAPACITY};
pub use catalog::{CatalogError, EventCatalog};
pub use install_id::{forget_install_id, load_or_create_install_id};

use crate::consent::{Consent, ConsentState};

/// What a feature calls to record a product event.
pub trait AnalyticsSink: Send + Sync {
    /// Records `event` with `properties`. Unlisted events and properties are dropped; this never
    /// blocks and never fails.
    fn track(&self, event: &str, properties: &Map<String, Value>);
}

/// A sink that does nothing (consent off, no key configured, tests).
#[derive(Clone, Copy, Debug, Default)]
pub struct NoopSink;

impl AnalyticsSink for NoopSink {
    fn track(&self, _event: &str, _properties: &Map<String, Value>) {}
}

/// An event ready to leave the process.
#[derive(Clone, Debug, PartialEq)]
pub struct OutgoingEvent {
    /// A name from the contract.
    pub name: String,
    /// The anonymous install id.
    pub distinct_id: String,
    /// Documented, well-typed, scrubbed properties.
    pub properties: Map<String, Value>,
}

/// Delivery of accepted events.
pub trait EventTransport: Send + Sync {
    /// Queues `event` for sending. Must not block.
    fn send(&self, event: OutgoingEvent);
}

/// The consent-gated sink.
pub struct Analytics {
    catalog: EventCatalog,
    consent: watch::Receiver<ConsentState>,
    install_id: Mutex<Option<String>>,
    transport: Arc<dyn EventTransport>,
}

impl Analytics {
    /// Creates the sink. The install id is loaded by [`Analytics::sync_install_id`].
    #[must_use]
    pub fn new(
        catalog: EventCatalog,
        consent: &Consent,
        transport: Arc<dyn EventTransport>,
    ) -> Self {
        Self {
            catalog,
            consent: consent.subscribe(),
            install_id: Mutex::new(None),
            transport,
        }
    }

    /// Makes the install id match the consent: with analytics on, loads (or creates and persists)
    /// the anonymous id; with analytics off, forgets it in memory and in the store, so the next
    /// opt-in starts a new, unlinked identity.
    ///
    /// # Errors
    /// The store failed; events stay dropped until it works.
    pub async fn sync_install_id(&self, consent: &Consent) -> Result<(), crate::ConsentError> {
        let id = if consent.state().analytics {
            Some(load_or_create_install_id(consent.store()).await?)
        } else {
            forget_install_id(consent.store()).await?;
            None
        };
        *self
            .install_id
            .lock()
            .unwrap_or_else(PoisonError::into_inner) = id;
        Ok(())
    }

    /// Keeps the install id in step with consent changes until `consent` is dropped. Spawn it once:
    /// `tokio::spawn(analytics.clone().run_install_id_sync(consent.clone()))`.
    pub async fn run_install_id_sync(self: Arc<Self>, consent: Arc<Consent>) {
        let mut changes = consent.subscribe();
        loop {
            if let Err(error) = self.sync_install_id(&consent).await {
                tracing::warn!(%error, "analytics install id not synced");
            }
            if changes.changed().await.is_err() {
                return;
            }
        }
    }

    fn current_id(&self) -> Option<String> {
        self.install_id
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
    }
}

impl AnalyticsSink for Analytics {
    fn track(&self, event: &str, properties: &Map<String, Value>) {
        if !self.consent.borrow().analytics {
            return;
        }
        let Some(sanitized) = self.catalog.sanitize(event, properties) else {
            tracing::debug!(event = %crate::scrub_pii(event), "analytics event not in the contract; dropped");
            return;
        };
        let Some(distinct_id) = self.current_id() else {
            tracing::debug!("analytics install id not ready; event dropped");
            return;
        };
        self.transport.send(OutgoingEvent {
            name: event.to_owned(),
            distinct_id,
            properties: sanitized,
        });
    }
}
