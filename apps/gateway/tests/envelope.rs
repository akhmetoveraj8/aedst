#![allow(clippy::expect_used, clippy::unwrap_used)]
//! Cross-language contracts: the Go bridge (`apps/server/internal/platform/natsbridge`) owns these
//! fixtures; if either side changes the format or the user-id derivation, both test suites fail.

use aedst_gateway::auth::user_id_for;
use aedst_gateway::consumer::handle;
use aedst_gateway::envelope::EventMeta;
use aedst_gateway::hub::{Hub, Outbound};
use serde::Deserialize;

const FIXTURES: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../server/internal/platform/natsbridge/testdata"
);

fn fixture(name: &str) -> String {
    std::fs::read_to_string(format!("{FIXTURES}/{name}")).expect("fixture is readable")
}

#[test]
fn the_golden_envelope_parses_and_is_forwarded_byte_for_byte() {
    let body = fixture("envelope.v1.json");
    let meta: EventMeta = serde_json::from_str(&body).expect("envelope parses");
    assert_eq!(meta.id, "0190f3a2-7b1c-7d4e-8a21-5c6d7e8f9a0d");
    assert_eq!(meta.event_type, "tasks.v1.TaskCompleted");

    let recipient = "0190f3a2-7b1c-7d4e-8a21-5c6d7e8f9a0c";
    let hub = Hub::new(1, 16, 4);
    let mut conn = hub.register(recipient).expect("register");
    let subject = format!("aedst.events.user.{recipient}.{}", meta.event_type);
    assert_eq!(handle(&hub, &subject, body.as_bytes()), 1);
    let frame = conn.rx.try_recv().expect("a frame");
    assert!(
        matches!(frame, Outbound::Frame(f) if *f == *body),
        "the client receives the published bytes unchanged"
    );
}

#[derive(Deserialize)]
struct Vector {
    issuer: String,
    subject: String,
    user_id: String,
}

#[test]
fn user_ids_match_go_ids_from_external() {
    let vectors: Vec<Vector> =
        serde_json::from_str(&fixture("user_id_vectors.json")).expect("vectors parse");
    assert!(!vectors.is_empty());
    for v in vectors {
        assert_eq!(
            user_id_for(&v.issuer, &v.subject),
            v.user_id,
            "{} {}",
            v.issuer,
            v.subject
        );
    }
}
