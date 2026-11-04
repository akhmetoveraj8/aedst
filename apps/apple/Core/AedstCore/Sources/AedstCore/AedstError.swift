import Foundation

/// The single error currency for every module boundary in the app — feature
/// modules never let a raw `URLError`, `DecodingError`, or Connect RPC error
/// escape their public surface. Mirrors `AedstError` in
/// `apps/android/core/common` and the `domain` error types in
/// `apps/server/internal/modules/*/domain`.
///
/// The case names are the shared error kinds of `docs/contract/behavior/error-kinds.json` (replayed by
/// `ErrorKindsReplayTests`); `decoding` and `unsupported` are Apple-local and count as `unknown` there.
///
/// `reason` payloads are for logs only: `errorDescription` (what users see) is
/// always a localized, human sentence and never interpolates them.
public enum AedstError: Error, Equatable, Sendable {
    /// The server failed or could not be reached while the device is online (5xx, connection reset).
    case unavailable(reason: String)
    /// The device has no usable connection; the operation may be queued and retried when it returns.
    case offline
    /// The call ran out of time (`deadline_exceeded`, `URLError.timedOut`).
    case timeout
    case unauthenticated
    /// Authenticated, but not allowed (e.g. a non-admin calling an admin RPC).
    case forbidden
    case notFound
    /// The resource changed since it was read (optimistic concurrency) or already exists.
    case conflict
    case invalidInput(fields: [String])
    case rateLimited(retryAfter: TimeInterval?)
    case decoding(reason: String)
    case storage(reason: String)
    /// The operation is not available in this configuration (e.g. a preview or test
    /// double that cannot sign in).
    case unsupported
    /// The server refuses this app version (`failed_precondition` + reason `CLIENT_UPGRADE_REQUIRED`, ADR-0009).
    /// Not retryable: the app shows a blocking upgrade screen instead of a generic error.
    case upgradeRequired
    /// The user dismissed an interactive flow (e.g. closed the sign-in sheet).
    /// Not a failure: callers must not show an error for it.
    case cancelled
    case unknown(reason: String)

    /// The shared kind name (error-kinds.json). `decoding` and `unsupported` are Apple-local and report as `unknown`.
    public var kind: String {
        switch self {
        case .unavailable: "unavailable"
        case .offline: "offline"
        case .timeout: "timeout"
        case .unauthenticated: "unauthenticated"
        case .forbidden: "forbidden"
        case .notFound: "notFound"
        case .conflict: "conflict"
        case .invalidInput: "invalidInput"
        case .rateLimited: "rateLimited"
        case .storage: "storage"
        case .upgradeRequired: "upgradeRequired"
        case .cancelled: "cancelled"
        case .decoding, .unsupported, .unknown: "unknown"
        }
    }

    /// Whether the same operation may succeed later (backoff, outbox retry). Same flags as error-kinds.json.
    public var isRetryable: Bool {
        switch self {
        case .unavailable, .offline, .timeout, .rateLimited: true
        case .unauthenticated, .forbidden, .notFound, .conflict, .invalidInput, .decoding, .storage, .unsupported, .upgradeRequired, .cancelled, .unknown: false
        }
    }

    /// Whether the error is worth a crash-reporter event: a bug or a storage fault, never an expected state.
    public var isReportable: Bool {
        switch self {
        case .storage, .decoding, .unsupported, .unknown: true
        case .unavailable, .offline, .timeout, .rateLimited, .unauthenticated, .forbidden, .notFound, .conflict, .invalidInput, .upgradeRequired, .cancelled: false
        }
    }

    /// A coarse, PII-free label safe to attach to analytics events (the shared kind name). Never
    /// send `technicalDescription` or an associated payload to analytics —
    /// those may carry response bodies or user input.
    public var analyticsCategory: String { kind }

    /// Developer-facing detail for logs and diagnostics. Not for UI.
    public var technicalDescription: String {
        switch self {
        case .unavailable(let reason): "unavailable: \(reason)"
        case .offline: "offline"
        case .timeout: "timeout"
        case .unauthenticated: "unauthenticated"
        case .forbidden: "forbidden"
        case .notFound: "notFound"
        case .conflict: "conflict"
        case .invalidInput(let fields): "invalidInput:\(fields.joined(separator: ", "))"
        case .rateLimited(let retryAfter): "rateLimited(retryAfter: \(retryAfter.map { String($0) } ?? "nil"))"
        case .decoding(let reason): "decoding: \(reason)"
        case .storage(let reason): "storage: \(reason)"
        case .unsupported: "unsupported"
        case .upgradeRequired: "upgradeRequired"
        case .cancelled: "cancelled"
        case .unknown(let reason): "unknown: \(reason)"
        }
    }
}

extension AedstError: LocalizedError {
    public var errorDescription: String? {
        switch self {
        case .unavailable, .offline, .timeout: String(localized: "errorNetwork", bundle: .module)
        case .unauthenticated: String(localized: "errorUnauthorized", bundle: .module)
        case .forbidden: String(localized: "errorForbidden", bundle: .module)
        case .notFound: String(localized: "errorNotFound", bundle: .module)
        case .conflict: String(localized: "errorConflict", bundle: .module)
        case .invalidInput: String(localized: "errorValidation", bundle: .module)
        case .rateLimited: String(localized: "errorRateLimited", bundle: .module)
        case .decoding, .unsupported, .cancelled, .unknown: String(localized: "errorUnknown", bundle: .module)
        case .storage: String(localized: "errorStorage", bundle: .module)
        case .upgradeRequired: String(localized: "errorUpgradeRequired", bundle: .module)
        }
    }
}
