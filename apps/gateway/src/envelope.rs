//! The event envelope, the client frame made from it, and the NATS subject it travels on.
//!
//! The NATS body is the Protobuf message `aedst.events.v1.EventEnvelope`
//! (`apps/server/api/proto/aedst/events/v1/envelope.proto`), decoded with code generated from that
//! file at build time (ADR-0026). Clients receive one JSON text frame per event:
//! `{id, type, version, occurred_at, partition_key, payload}`, where `payload` is the producer's JSON
//! object copied unchanged. Both ends are pinned by the fixtures in
//! `apps/server/internal/platform/natsbridge/testdata` (`tests/envelope.rs`).

use buffa::Message as _;
use buffa_types::google::protobuf::Timestamp;
use serde::Serialize;
use serde_json::value::RawValue;
use thiserror::Error;

use crate::proto::aedst::events::v1::EventEnvelope;

/// Prefix of every subject the bridge publishes to.
pub const SUBJECT_PREFIX: &str = "aedst.events.user.";

/// Why a message cannot be delivered. A retry could never fix it, so it is logged and dropped.
#[derive(Debug, Error)]
pub enum EnvelopeError {
    /// The body is not an `EventEnvelope`.
    #[error("body is not an EventEnvelope: {0}")]
    Decode(String),
    /// A required field is empty or the payload is not a JSON object.
    #[error("invalid envelope: {0}")]
    Invalid(&'static str),
    /// The frame could not be serialised.
    #[error("frame: {0}")]
    Frame(String),
}

/// An event ready for the clients of its recipient.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Event {
    /// Event id (UUIDv7), the idempotency key.
    pub id: String,
    /// Event type, e.g. `tasks.v1.TaskCompleted`.
    pub event_type: String,
    /// The JSON text frame sent to every socket of the recipient.
    pub frame: String,
}

/// The client frame. Field names are the v1 client contract (spec `realtime/ws-gateway`).
#[derive(Serialize)]
struct Frame<'a> {
    id: &'a str,
    #[serde(rename = "type")]
    event_type: &'a str,
    version: u32,
    occurred_at: &'a Timestamp,
    partition_key: &'a str,
    payload: &'a RawValue,
}

/// Decodes a NATS body and renders the client frame.
///
/// # Errors
/// [`EnvelopeError`] when the body is not a complete envelope with a JSON object payload.
pub fn decode(body: &[u8]) -> Result<Event, EnvelopeError> {
    let envelope =
        EventEnvelope::decode_from_slice(body).map_err(|e| EnvelopeError::Decode(e.to_string()))?;
    if envelope.id.is_empty() || envelope.r#type.is_empty() {
        return Err(EnvelopeError::Invalid("id and type are required"));
    }
    let occurred_at = envelope
        .occurred_at
        .as_option()
        .ok_or(EnvelopeError::Invalid("occurred_at is required"))?;
    let text = std::str::from_utf8(&envelope.payload)
        .map_err(|_| EnvelopeError::Invalid("payload is not UTF-8"))?;
    let payload: &RawValue =
        serde_json::from_str(text).map_err(|_| EnvelopeError::Invalid("payload is not JSON"))?;
    if !payload.get().starts_with('{') {
        return Err(EnvelopeError::Invalid("payload is not a JSON object"));
    }
    let frame = serde_json::to_string(&Frame {
        id: &envelope.id,
        event_type: &envelope.r#type,
        version: envelope.version,
        occurred_at,
        partition_key: &envelope.partition_key,
        payload,
    })
    .map_err(|e| EnvelopeError::Frame(e.to_string()))?;
    Ok(Event {
        id: envelope.id,
        event_type: envelope.r#type,
        frame,
    })
}

/// Returns the recipient user id carried by a subject `aedst.events.user.<user id>.<event type>`.
#[must_use]
pub fn recipient_of(subject: &str) -> Option<&str> {
    let rest = subject.strip_prefix(SUBJECT_PREFIX)?;
    let (user, event_type) = rest.split_once('.')?;
    (!user.is_empty() && !event_type.is_empty()).then_some(user)
}

#[cfg(test)]
mod tests {
    use buffa::MessageField;

    use super::*;

    fn envelope(payload: &str) -> Vec<u8> {
        EventEnvelope {
            id: "e1".into(),
            r#type: "tasks.v1.TaskCompleted".into(),
            version: 1,
            occurred_at: MessageField::some(Timestamp::from_unix(1_772_359_200, 0)),
            partition_key: "p".into(),
            payload: payload.as_bytes().to_vec(),
            ..Default::default()
        }
        .encode_to_vec()
    }

    #[test]
    fn the_frame_carries_the_payload_unchanged() {
        let event = decode(&envelope(r#"{"b":1,"a":"x"}"#)).unwrap();
        assert_eq!(event.id, "e1");
        assert_eq!(event.event_type, "tasks.v1.TaskCompleted");
        assert_eq!(
            event.frame,
            r#"{"id":"e1","type":"tasks.v1.TaskCompleted","version":1,"occurred_at":"2026-03-01T10:00:00Z","partition_key":"p","payload":{"b":1,"a":"x"}}"#
        );
    }

    #[test]
    fn malformed_bodies_are_refused() {
        assert!(decode(b"\xff\xff\xff").is_err(), "not protobuf");
        assert!(decode(&envelope("not json")).is_err());
        assert!(decode(&envelope("[1]")).is_err(), "not an object");
        assert!(decode(&EventEnvelope::default().encode_to_vec()).is_err());
    }

    #[test]
    fn recipient_is_the_token_after_the_prefix() {
        let subject =
            "aedst.events.user.0190f3a2-7b1c-7d4e-8a21-5c6d7e8f9a0c.tasks.v1.TaskCompleted";
        assert_eq!(
            recipient_of(subject),
            Some("0190f3a2-7b1c-7d4e-8a21-5c6d7e8f9a0c")
        );
    }

    #[test]
    fn foreign_or_short_subjects_have_no_recipient() {
        for subject in [
            "aedst.events.other.x.y",
            "aedst.events.user.",
            "aedst.events.user.abc",
            "",
        ] {
            assert_eq!(recipient_of(subject), None, "{subject}");
        }
    }
}
