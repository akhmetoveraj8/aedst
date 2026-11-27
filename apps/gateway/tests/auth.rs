#![allow(clippy::expect_used, clippy::unwrap_used)]
//! How the Go server's answer becomes a caller (ADR-0026). The call itself is covered end to end by
//! `apps/server/internal/platform/natsbridge/gateway_e2e_integration_test.go`.

use aedst_gateway::auth::{AuthError, Principal, classify, principal_from};
use aedst_gateway::proto::aedst::realtime::v1::GetConnectionAccessResponse;
use buffa::MessageField;
use buffa_types::google::protobuf::Timestamp;
use connectrpc::{ConnectError, ErrorCode};

fn answer(user_id: &str, expires_at: Option<i64>) -> GetConnectionAccessResponse {
    GetConnectionAccessResponse {
        user_id: user_id.into(),
        expires_at: expires_at.map_or_else(MessageField::none, |s| {
            MessageField::some(Timestamp::from_unix(s, 0))
        }),
        ..Default::default()
    }
}

#[test]
fn a_complete_answer_is_the_caller() {
    let principal = principal_from(&answer("u1", Some(1_800_000_000))).unwrap();
    assert_eq!(
        principal,
        Principal {
            user_id: "u1".into(),
            expires_at: 1_800_000_000
        }
    );
}

#[test]
fn an_incomplete_answer_is_a_server_fault_not_a_refusal() {
    for (name, response) in [
        ("no user", answer("", Some(1_800_000_000))),
        ("no expiry", answer("u1", None)),
        ("expiry before the epoch", answer("u1", Some(-1))),
    ] {
        assert!(
            matches!(principal_from(&response), Err(AuthError::Unavailable(_))),
            "{name}"
        );
    }
}

#[test]
fn refusals_and_throttling_are_the_clients_fault_the_rest_is_ours() {
    for code in [ErrorCode::Unauthenticated, ErrorCode::PermissionDenied] {
        assert!(matches!(
            classify(&ConnectError::new(code, "no")),
            AuthError::Refused(_)
        ));
    }
    assert!(matches!(
        classify(&ConnectError::new(
            ErrorCode::ResourceExhausted,
            "slow down"
        )),
        AuthError::Throttled(_)
    ));
    for code in [
        ErrorCode::Unavailable,
        ErrorCode::DeadlineExceeded,
        ErrorCode::Internal,
    ] {
        assert!(matches!(
            classify(&ConnectError::new(code, "no")),
            AuthError::Unavailable(_)
        ));
    }
}
