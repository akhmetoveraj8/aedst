//! The JetStream side: an ephemeral pull consumer per gateway replica (every replica sees every
//! event and delivers to its own sockets), acknowledging each message after it was handed to the hub.
//!
//! Delivery to clients is a nudge, not the source of truth (ADR-0020): events for users with no
//! socket here are acknowledged and dropped, and the consumer starts at "new" so a restart does not
//! replay history to anyone.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use async_nats::jetstream::{self, consumer::AckPolicy, consumer::DeliverPolicy, consumer::pull};
use futures::StreamExt;
use thiserror::Error;
use tokio_util::sync::CancellationToken;

use crate::envelope::{EventMeta, SUBJECT_PREFIX, recipient_of};
use crate::hub::Hub;

const RETRY_DELAY: Duration = Duration::from_secs(2);
/// A consumer nobody pulls from for this long is deleted by the server.
const INACTIVE_THRESHOLD: Duration = Duration::from_secs(300);

/// Why a consume attempt ended.
#[derive(Debug, Error)]
pub enum ConsumerError {
    /// A NATS or JetStream call failed.
    #[error("nats: {0}")]
    Nats(String),
}

fn nats<E: std::fmt::Display>(e: E) -> ConsumerError {
    ConsumerError::Nats(e.to_string())
}

/// Connects to NATS and consumes until `cancel` fires, reconnecting on failure. `ready` is true
/// while a consumer is attached (it backs `/readyz`).
pub async fn run(url: String, stream: String, hub: Arc<Hub>, ready: Arc<AtomicBool>, cancel: CancellationToken) {
    let options = async_nats::ConnectOptions::new().name("aedst-gateway").retry_on_initial_connect();
    let client = match options.connect(&url).await {
        Ok(client) => client,
        Err(error) => {
            tracing::error!(%error, "nats connect failed");
            return;
        }
    };
    let js = jetstream::new(client);
    loop {
        tokio::select! {
            () = cancel.cancelled() => break,
            result = consume(&js, &stream, &hub, &ready) => {
                ready.store(false, Ordering::Relaxed);
                if let Err(error) = result {
                    tracing::warn!(%error, "jetstream consumer ended; retrying");
                }
                tokio::select! {
                    () = cancel.cancelled() => break,
                    () = tokio::time::sleep(RETRY_DELAY) => {}
                }
            }
        }
    }
    ready.store(false, Ordering::Relaxed);
}

async fn consume(js: &jetstream::Context, stream: &str, hub: &Hub, ready: &AtomicBool) -> Result<(), ConsumerError> {
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
    ready.store(true, Ordering::Relaxed);
    tracing::info!("jetstream consumer attached");
    while let Some(message) = messages.next().await {
        let message = message.map_err(nats)?;
        handle(hub, message.subject.as_str(), &message.payload);
        message.ack().await.map_err(nats)?;
    }
    Ok(())
}

/// Routes one message to the connections of its recipient. Malformed messages are logged and
/// dropped (a retry could never succeed).
pub fn handle(hub: &Hub, subject: &str, payload: &[u8]) -> usize {
    let Some(user) = recipient_of(subject) else {
        tracing::warn!(subject, "event on a subject without a recipient dropped");
        return 0;
    };
    let (Ok(meta), Ok(body)) = (serde_json::from_slice::<EventMeta>(payload), std::str::from_utf8(payload)) else {
        tracing::warn!(subject, "malformed event dropped");
        return 0;
    };
    let delivered = hub.dispatch(user, &meta.id, &Arc::from(body));
    tracing::debug!(event_id = %meta.id, event_type = %meta.event_type, delivered, "event routed");
    delivered
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hub::Outbound;

    const SUBJECT: &str = "aedst.events.user.u1.tasks.v1.TaskCompleted";
    const BODY: &str = r#"{"id":"e1","type":"tasks.v1.TaskCompleted","version":1,"occurred_at":"2026-03-01T10:00:00Z","partition_key":"p","payload":{"user_id":"u1"}}"#;

    #[tokio::test]
    async fn routes_the_unchanged_body_to_the_recipient() {
        let hub = Hub::new(2, 4);
        let mut conn = hub.register("u1").unwrap();
        assert_eq!(handle(&hub, SUBJECT, BODY.as_bytes()), 1);
        assert!(matches!(conn.rx.recv().await, Some(Outbound::Frame(f)) if &*f == BODY));
    }

    #[test]
    fn malformed_and_unaddressed_messages_are_dropped() {
        let hub = Hub::new(2, 4);
        let _conn = hub.register("u1").unwrap();
        assert_eq!(handle(&hub, SUBJECT, b"not json"), 0);
        assert_eq!(handle(&hub, "aedst.events.other", BODY.as_bytes()), 0);
    }
}
