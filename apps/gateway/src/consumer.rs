//! The JetStream side: an ephemeral pull consumer per gateway replica (every replica sees every
//! event and delivers to its own sockets), acknowledging each message after it was handed to the hub.
//!
//! Delivery to clients is a nudge, not the source of truth (ADR-0021): events for users with no
//! socket here are acknowledged and dropped, and the consumer starts at "new" so a restart does not
//! replay history to anyone.
//!
//! The consumer never gives up: a failed connect or a broken consumer is retried with capped
//! exponential backoff and jitter until shutdown. Its state is visible in `/readyz` and in the
//! metrics `aedst_gateway_consumer_attached` and `aedst_gateway_consumer_reconnects_total`.

use std::hash::{BuildHasher, RandomState};
use std::sync::Arc;
use std::sync::atomic::{AtomicU8, AtomicU64, Ordering};
use std::time::Duration;

use async_nats::jetstream::{self, consumer::AckPolicy, consumer::DeliverPolicy, consumer::pull};
use futures::StreamExt;
use opentelemetry::metrics::{Counter, Gauge};
use thiserror::Error;
use tokio_util::sync::CancellationToken;

use crate::envelope::{SUBJECT_PREFIX, decode, recipient_of};
use crate::hub::Hub;

/// First retry delay; doubled on every further failure.
const BACKOFF_BASE: Duration = Duration::from_millis(500);
/// Longest retry delay.
const BACKOFF_CAP: Duration = Duration::from_secs(30);
/// A consumer nobody pulls from for this long is deleted by the server.
const INACTIVE_THRESHOLD: Duration = Duration::from_secs(300);
/// Instrumentation scope of the gateway's metrics.
const METER: &str = "aedst-gateway";

/// Why a consume attempt ended.
#[derive(Debug, Error)]
pub enum ConsumerError {
    /// A NATS or JetStream call failed.
    #[error("nats: {0}")]
    Nats(String),
    /// The message stream ended without an error.
    #[error("the consumer's message stream ended")]
    Ended,
}

fn nats<E: std::fmt::Display>(e: E) -> ConsumerError {
    ConsumerError::Nats(e.to_string())
}

/// What the consumer is doing right now.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConsumerState {
    /// Connecting to NATS or creating the consumer.
    Connecting,
    /// Attached to the stream and receiving events.
    Attached,
    /// The last attempt failed; waiting to retry.
    Retrying,
    /// The process is shutting down.
    Stopped,
}

impl ConsumerState {
    /// The name shown in `/readyz`.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Connecting => "connecting",
            Self::Attached => "attached",
            Self::Retrying => "retrying",
            Self::Stopped => "stopped",
        }
    }
}

/// The consumer's state, shared with the HTTP handlers.
#[derive(Debug, Default)]
pub struct ConsumerHealth {
    state: AtomicU8,
    reconnects: AtomicU64,
}

impl ConsumerHealth {
    /// The current state.
    #[must_use]
    pub fn state(&self) -> ConsumerState {
        match self.state.load(Ordering::Relaxed) {
            1 => ConsumerState::Attached,
            2 => ConsumerState::Retrying,
            3 => ConsumerState::Stopped,
            _ => ConsumerState::Connecting,
        }
    }

    /// Records a state change.
    pub fn set(&self, state: ConsumerState) {
        let value = match state {
            ConsumerState::Connecting => 0,
            ConsumerState::Attached => 1,
            ConsumerState::Retrying => 2,
            ConsumerState::Stopped => 3,
        };
        self.state.store(value, Ordering::Relaxed);
    }

    /// True while events are being received (backs `/readyz`).
    #[must_use]
    pub fn is_attached(&self) -> bool {
        self.state() == ConsumerState::Attached
    }

    /// How many times the consumer had to retry since the process started.
    #[must_use]
    pub fn reconnects(&self) -> u64 {
        self.reconnects.load(Ordering::Relaxed)
    }
}

/// The consumer's instruments. Without a configured exporter they record nothing.
struct Metrics {
    attached: Gauge<u64>,
    reconnects: Counter<u64>,
}

impl Metrics {
    fn new() -> Self {
        let meter = opentelemetry::global::meter(METER);
        Self {
            attached: meter
                .u64_gauge("aedst_gateway_consumer_attached")
                .with_description("1 while the JetStream consumer is attached, else 0")
                .build(),
            reconnects: meter
                .u64_counter("aedst_gateway_consumer_reconnects_total")
                .with_description("Retries of the JetStream consumer since the process started")
                .build(),
        }
    }
}

/// The delay before retry number `attempt` (0-based): `BACKOFF_BASE` doubled per attempt, capped at
/// `BACKOFF_CAP`, then half of it fixed and half random ("equal jitter"), so replicas that lost
/// NATS together do not come back together.
#[must_use]
pub fn backoff(attempt: u32, random: u64) -> Duration {
    let doubled = BACKOFF_BASE.saturating_mul(1_u32 << attempt.min(16));
    let half = doubled.min(BACKOFF_CAP) / 2;
    let span = u64::try_from(half.as_millis()).unwrap_or(u64::MAX).max(1);
    half + Duration::from_millis(random % span)
}

/// A random number from the standard library's hasher seed (no extra crate for one jitter value).
fn random() -> u64 {
    RandomState::new().hash_one(0_u8)
}

/// Connects to NATS and consumes until `cancel` fires. `health` is `Attached` while a consumer
/// receives events.
pub async fn run(
    url: String,
    stream: String,
    hub: Arc<Hub>,
    health: Arc<ConsumerHealth>,
    cancel: CancellationToken,
) {
    let metrics = Metrics::new();
    let mut context = None;
    let mut attempt = 0_u32;
    loop {
        let result = tokio::select! {
            () = cancel.cancelled() => break,
            result = session(&url, &stream, &hub, &health, &metrics, &mut context) => result,
        };
        // A session that was attached counts as a success: the next failure starts from the base delay.
        if health.is_attached() {
            attempt = 0;
        }
        let delay = backoff(attempt, random());
        attempt = attempt.saturating_add(1);
        health.set(ConsumerState::Retrying);
        health.reconnects.fetch_add(1, Ordering::Relaxed);
        metrics.attached.record(0, &[]);
        metrics.reconnects.add(1, &[]);
        let error = result.err().unwrap_or(ConsumerError::Ended);
        let retry_in_ms = u64::try_from(delay.as_millis()).unwrap_or(u64::MAX);
        tracing::warn!(%error, attempt, retry_in_ms, "jetstream consumer stopped; retrying");
        tokio::select! {
            () = cancel.cancelled() => break,
            () = tokio::time::sleep(delay) => {}
        }
    }
    health.set(ConsumerState::Stopped);
    metrics.attached.record(0, &[]);
}

/// One attempt: connect if there is no connection yet, then consume until something fails. The
/// connection is kept for the next attempt (the client reconnects by itself).
async fn session(
    url: &str,
    stream: &str,
    hub: &Hub,
    health: &ConsumerHealth,
    metrics: &Metrics,
    context: &mut Option<jetstream::Context>,
) -> Result<(), ConsumerError> {
    health.set(ConsumerState::Connecting);
    if context.is_none() {
        let options = async_nats::ConnectOptions::new()
            .name("aedst-gateway")
            .retry_on_initial_connect();
        let client = options.connect(url).await.map_err(nats)?;
        *context = Some(jetstream::new(client));
    }
    let Some(js) = context.as_ref() else {
        return Err(ConsumerError::Ended);
    };
    consume(js, stream, hub, health, metrics).await
}

async fn consume(
    js: &jetstream::Context,
    stream: &str,
    hub: &Hub,
    health: &ConsumerHealth,
    metrics: &Metrics,
) -> Result<(), ConsumerError> {
    // The stream is owned and configured by the Go bridge; the gateway only reads it.
    let stream = js.get_stream(stream).await.map_err(nats)?;
    let consumer = stream
        .create_consumer(pull::Config {
            filter_subject: format!("{SUBJECT_PREFIX}>"),
            deliver_policy: DeliverPolicy::New,
            ack_policy: AckPolicy::Explicit,
            inactive_threshold: INACTIVE_THRESHOLD,
            ..Default::default()
        })
        .await
        .map_err(nats)?;
    let mut messages = consumer.messages().await.map_err(nats)?;
    health.set(ConsumerState::Attached);
    metrics.attached.record(1, &[]);
    tracing::info!("jetstream consumer attached");
    while let Some(message) = messages.next().await {
        let message = message.map_err(nats)?;
        handle(hub, message.subject.as_str(), &message.payload);
        message.ack().await.map_err(nats)?;
    }
    Err(ConsumerError::Ended)
}

/// Routes one message to the connections of its recipient. Malformed messages are logged and
/// dropped (a retry could never succeed).
pub fn handle(hub: &Hub, subject: &str, payload: &[u8]) -> usize {
    let Some(user) = recipient_of(subject) else {
        tracing::warn!(subject, "event on a subject without a recipient dropped");
        return 0;
    };
    let event = match decode(payload) {
        Ok(event) => event,
        Err(error) => {
            tracing::warn!(subject, %error, "malformed event dropped");
            return 0;
        }
    };
    let delivered = hub.dispatch(user, &event.id, &Arc::from(event.frame.as_str()));
    tracing::debug!(event_id = %event.id, event_type = %event.event_type, delivered, "event routed");
    delivered
}

#[cfg(test)]
mod tests {
    use buffa::{Message as _, MessageField};
    use buffa_types::google::protobuf::Timestamp;

    use super::*;
    use crate::hub::Outbound;
    use crate::proto::aedst::events::v1::EventEnvelope;

    const SUBJECT: &str = "aedst.events.user.u1.tasks.v1.TaskCompleted";
    const FRAME: &str = r#"{"id":"e1","type":"tasks.v1.TaskCompleted","version":1,"occurred_at":"2026-03-01T10:00:00Z","partition_key":"p","payload":{"user_id":"u1"}}"#;

    fn body() -> Vec<u8> {
        EventEnvelope {
            id: "e1".into(),
            r#type: "tasks.v1.TaskCompleted".into(),
            version: 1,
            occurred_at: MessageField::some(Timestamp::from_unix(1_772_359_200, 0)),
            partition_key: "p".into(),
            payload: br#"{"user_id":"u1"}"#.to_vec(),
            ..Default::default()
        }
        .encode_to_vec()
    }

    #[tokio::test]
    async fn routes_the_client_frame_to_the_recipient() {
        let hub = Hub::new(2, 16, 4);
        let mut conn = hub.register("u1").unwrap();
        assert_eq!(handle(&hub, SUBJECT, &body()), 1);
        assert!(matches!(conn.rx.recv().await, Some(Outbound::Frame(f)) if &*f == FRAME));
    }

    #[test]
    fn malformed_and_unaddressed_messages_are_dropped() {
        let hub = Hub::new(2, 16, 4);
        let _conn = hub.register("u1").unwrap();
        assert_eq!(handle(&hub, SUBJECT, b"not protobuf \xff"), 0);
        assert_eq!(handle(&hub, "aedst.events.other", &body()), 0);
    }

    #[test]
    fn backoff_doubles_is_capped_and_jittered_within_half() {
        assert_eq!(backoff(0, 0), BACKOFF_BASE / 2);
        assert_eq!(backoff(1, 0), BACKOFF_BASE);
        assert_eq!(
            backoff(40, 0),
            BACKOFF_CAP / 2,
            "the exponent does not overflow"
        );
        for random in [0, 1, 12_345, u64::MAX] {
            for attempt in 0..12 {
                let delay = backoff(attempt, random);
                assert!(delay >= BACKOFF_BASE / 2, "{attempt} {random}");
                assert!(delay < BACKOFF_CAP, "{attempt} {random}");
            }
        }
    }

    #[test]
    fn health_starts_connecting_and_reports_the_state() {
        let health = ConsumerHealth::default();
        assert_eq!(health.state(), ConsumerState::Connecting);
        assert!(!health.is_attached());
        health.set(ConsumerState::Attached);
        assert!(health.is_attached());
        health.set(ConsumerState::Retrying);
        assert_eq!(health.state().as_str(), "retrying");
        assert_eq!(health.reconnects(), 0);
    }
}
