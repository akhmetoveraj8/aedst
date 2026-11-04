import AedstCore
import Connect
import Foundation

/// The one place a `ConnectError` is allowed to turn into an `AedstError` —
/// feature repositories call this instead of each pattern-matching Connect's
/// `Code` enum themselves. The table is shared with every client
/// (docs/contract/behavior/error-kinds.json, replayed by `ErrorKindsReplayTests`).
public enum NetworkErrorMapping {
    public static func map(_ error: Error) -> AedstError {
        guard let connectError = error as? ConnectError else {
            return mapTransport(error) ?? .unknown(reason: String(describing: error))
        }

        switch connectError.code {
        case .unauthenticated:
            return .unauthenticated
        case .permissionDenied:
            // Authenticated but not allowed (e.g. a non-admin calling AdminService):
            // never "your session ended", which would wrongly suggest signing in again.
            return .forbidden
        case .notFound:
            return .notFound
        case .failedPrecondition where UpgradeRequiredDetection.isUpgradeRequired(connectError):
            // ADR-0009: this app version is below the server's minimum. Its own error so no screen shows it
            // as a generic validation failure; the app-level upgrade screen is driven by ClientUpgradeMonitor.
            return .upgradeRequired
        case .invalidArgument, .failedPrecondition, .outOfRange:
            return .invalidInput(fields: [connectError.message ?? "request"])
        case .aborted, .alreadyExists:
            // ABORTED is the optimistic-concurrency conflict (`expected_version`
            // mismatch in TasksService.UpdateTask): re-read and retry.
            return .conflict
        case .resourceExhausted:
            return .rateLimited(retryAfter: nil)
        case .deadlineExceeded:
            return .timeout
        case .canceled:
            return .cancelled
        case .unavailable:
            // connect-swift reports a dead connection as `unavailable` with the URLError underneath.
            return connectError.exception.flatMap(mapTransport)
                ?? .unavailable(reason: connectError.message ?? connectError.code.name)
        default:
            return .unknown(reason: connectError.message ?? connectError.code.name)
        }
    }

    /// Client-side transport failures (no Connect code): no connection, client timeout, caller abort.
    private static func mapTransport(_ error: Error) -> AedstError? {
        guard let urlError = error as? URLError else { return nil }
        switch urlError.code {
        case .notConnectedToInternet, .dataNotAllowed, .internationalRoamingOff, .networkConnectionLost:
            return .offline
        case .timedOut:
            return .timeout
        case .cancelled:
            return .cancelled
        default:
            return nil
        }
    }
}
