//! Replays `docs/contract/behavior/error-kinds.json`, the fixture shared with every client.
#![allow(clippy::unwrap_used, clippy::expect_used)] // test code: a panic is the failure report

use aedst_common::{ErrorKind, OutboxVerdict, Transport};
use serde_json::Value;

const FIXTURE: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../../docs/contract/behavior/error-kinds.json"
);

fn fixture() -> Value {
    serde_json::from_str(&std::fs::read_to_string(FIXTURE).expect("fixture")).unwrap()
}

#[test]
fn every_case_of_the_shared_fixture_passes() {
    let fixture = fixture();
    for case in fixture["cases"].as_array().unwrap() {
        let id = case["id"].as_str().unwrap();
        let kind = if let Some(code) = case["code"].as_str() {
            ErrorKind::from_code(code, case["reason"].as_str())
        } else {
            let transport = match case["transport"].as_str().unwrap() {
                "offline" => Transport::Offline,
                "timeout" => Transport::Timeout,
                "aborted" => Transport::Aborted,
                "storage" => Transport::Storage,
                other => panic!("unknown transport {other}"),
            };
            ErrorKind::from_transport(transport)
        };
        let expect = &case["expect"];
        assert_eq!(kind.name(), expect["kind"].as_str().unwrap(), "{id}: kind");
        assert_eq!(
            kind.retryable(),
            expect["retryable"].as_bool().unwrap(),
            "{id}: retryable"
        );
        assert_eq!(
            kind.reportable(),
            expect["reportable"].as_bool().unwrap(),
            "{id}: reportable"
        );
    }
}

#[test]
fn every_connect_code_in_the_fixture_maps_to_its_kind() {
    let fixture = fixture();
    for (code, kind) in fixture["connectCodes"].as_object().unwrap() {
        assert_eq!(
            ErrorKind::from_code(code, None).name(),
            kind.as_str().unwrap(),
            "{code}"
        );
    }
}

#[test]
fn kinds_and_outbox_verdicts_match_the_fixture() {
    let fixture = fixture();
    let kinds = fixture["kinds"].as_object().unwrap();
    assert_eq!(
        kinds.len(),
        ErrorKind::ALL.len(),
        "a kind was added to one side only"
    );
    for kind in ErrorKind::ALL {
        let spec = &kinds[kind.name()];
        assert_eq!(
            kind.retryable(),
            spec["retryable"].as_bool().unwrap(),
            "{}",
            kind.name()
        );
        assert_eq!(
            kind.reportable(),
            spec["reportable"].as_bool().unwrap(),
            "{}",
            kind.name()
        );
        let verdict = match spec["outbox"].as_str().unwrap() {
            "retry" => OutboxVerdict::Retry,
            "permanent" => OutboxVerdict::Permanent,
            "blocked" => OutboxVerdict::Blocked,
            other => panic!("unknown verdict {other}"),
        };
        assert_eq!(kind.outbox_verdict(), verdict, "{}", kind.name());
    }
}
