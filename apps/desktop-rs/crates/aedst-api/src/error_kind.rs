//! Classifying a `ConnectError` into the shared [`ErrorKind`].
//!
//! Rules from `docs/contract/behavior/error-kinds.json`: the Connect code maps through
//! `ErrorKind::from_code`; `failed_precondition` carrying the `ErrorInfo` reason
//! `CLIENT_UPGRADE_REQUIRED` is `UpgradeRequired`; `unavailable` with no usable connection is
//! `Offline`. The reason is read from the error detail's JSON `debug` form (the Connect protocol
//! sends it with every detail); a detail without it leaves the kind at `InvalidInput`.

use aedst_common::ErrorKind;
use connectrpc::ConnectError;

const ERROR_INFO: &str = "google.rpc.ErrorInfo";

fn reason(error: &ConnectError) -> Option<&str> {
    error
        .details
        .iter()
        .find(|detail| detail.type_url.ends_with(ERROR_INFO))
        .and_then(|detail| detail.debug.as_ref())
        .and_then(|debug| debug.get("reason"))
        .and_then(serde_json::Value::as_str)
}

/// The kind of `error`. `online` is the device's connectivity: `unavailable` while offline is `Offline`.
#[must_use]
pub fn kind_of(error: &ConnectError, online: bool) -> ErrorKind {
    let kind = ErrorKind::from_code(error.code.as_str(), reason(error));
    if kind == ErrorKind::Unavailable && !online {
        ErrorKind::Offline
    } else {
        kind
    }
}

#[cfg(test)]
mod tests {
    use connectrpc::{ConnectError, ErrorCode, ErrorDetail};

    use super::*;

    fn with_reason(code: ErrorCode, reason: &str) -> ConnectError {
        let mut error = ConnectError::new(code, "refused");
        error.details.push(ErrorDetail {
            type_url: "google.rpc.ErrorInfo".into(),
            value: None,
            debug: Some(serde_json::json!({ "reason": reason })),
        });
        error
    }

    #[test]
    fn codes_map_to_kinds() {
        assert_eq!(
            kind_of(&ConnectError::unauthenticated("x"), true),
            ErrorKind::Unauthenticated
        );
        assert_eq!(
            kind_of(&ConnectError::new(ErrorCode::PermissionDenied, "x"), true),
            ErrorKind::Forbidden
        );
        assert_eq!(
            kind_of(&ConnectError::new(ErrorCode::Internal, "x"), true),
            ErrorKind::Unknown
        );
    }

    #[test]
    fn the_upgrade_reason_overrides_failed_precondition() {
        let error = with_reason(ErrorCode::FailedPrecondition, "CLIENT_UPGRADE_REQUIRED");
        assert_eq!(kind_of(&error, true), ErrorKind::UpgradeRequired);
        let other = with_reason(ErrorCode::FailedPrecondition, "SOMETHING_ELSE");
        assert_eq!(kind_of(&other, true), ErrorKind::InvalidInput);
        assert_eq!(
            kind_of(&ConnectError::new(ErrorCode::FailedPrecondition, "x"), true),
            ErrorKind::InvalidInput
        );
    }

    #[test]
    fn unavailable_is_offline_without_a_connection() {
        let error = ConnectError::unavailable("down");
        assert_eq!(kind_of(&error, true), ErrorKind::Unavailable);
        assert_eq!(kind_of(&error, false), ErrorKind::Offline);
    }
}
