#![allow(clippy::expect_used, clippy::unwrap_used)]
//! Cross-language contract: the Go bridge (`apps/server/internal/platform/natsbridge`) owns these
//! fixtures. `envelope.v1.binpb` is the Protobuf body Go publishes for the event in `frame.v1.json`;
//! the gateway must decode it and send exactly that frame. If either side changes, both suites fail.

use aedst_gateway::consumer::handle;
use aedst_gateway::envelope::decode;
use aedst_gateway::hub::{Hub, Outbound};

const FIXTURES: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../server/internal/platform/natsbridge/testdata"
);

fn fixture(name: &str) -> Vec<u8> {
    std::fs::read(format!("{FIXTURES}/{name}")).expect("fixture is readable")
}

fn json(bytes: &[u8]) -> serde_json::Value {
    serde_json::from_slice(bytes).expect("valid JSON")
}

#[test]
fn the_golden_envelope_becomes_the_golden_frame() {
    let event = decode(&fixture("envelope.v1.binpb")).expect("envelope decodes");
    assert_eq!(event.id, "0190f3a2-7b1c-7d4e-8a21-5c6d7e8f9a0d");
    assert_eq!(event.event_type, "tasks.v1.TaskCompleted");
    assert_eq!(
        json(event.frame.as_bytes()),
        json(&fixture("frame.v1.json")),
        "the client frame is the v1 contract"
    );
}

#[test]
fn the_golden_envelope_reaches_its_recipient() {
    let recipient = "0190f3a2-7b1c-7d4e-8a21-5c6d7e8f9a0c";
    let hub = Hub::new(1, 16, 4);
    let mut conn = hub.register(recipient).expect("register");
    let subject = format!("aedst.events.user.{recipient}.tasks.v1.TaskCompleted");
    assert_eq!(handle(&hub, &subject, &fixture("envelope.v1.binpb")), 1);
    let frame = conn.rx.try_recv().expect("a frame");
    assert!(
        matches!(frame, Outbound::Frame(f) if json(f.as_bytes()) == json(&fixture("frame.v1.json")))
    );
}
