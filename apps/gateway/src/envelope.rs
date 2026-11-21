//! The event envelope and the NATS subject it travels on.
//!
//! The wire format is owned by the Go side (`internal/platform/natsbridge`) and pinned by
//! `testdata/envelope.v1.json` there; `tests/envelope.rs` parses the same file. The gateway
//! forwards the body bytes unchanged: it parses only to read the `id` (deduplication).

use serde::Deserialize;

/// Prefix of every subject the bridge publishes to.
pub const SUBJECT_PREFIX: &str = "aedst.events.user.";

/// The fields of an event the gateway reads. Unknown fields are ignored on purpose: events only
/// gain fields within a version, and the frame sent to the client is the original body.
#[derive(Debug, Clone, Deserialize)]
pub struct EventMeta {
    /// Event id (UUIDv7), the idempotency key.
    pub id: String,
    /// Event type, e.g. `tasks.v1.TaskCompleted`.
    #[serde(rename = "type")]
    pub event_type: String,
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
    use super::*;

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
