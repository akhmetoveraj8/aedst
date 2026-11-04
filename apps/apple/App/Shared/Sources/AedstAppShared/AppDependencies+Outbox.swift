import AedstAnalytics
import AedstCore
import AedstNetwork
import AedstPersistence
import Foundation
import Media
import Tasks

/// Offline-write wiring for the composition root (behaviour `offline-outbox`, ADR-0013): which feature handlers
/// the drainer knows, and which signals drain it. Kept out of `AppDependencies.swift` to keep that file small.
extension AppDependencies {
    /// Every feature contributes its handlers here (Android: Hilt `@IntoSet OutboxHandler`). A type nobody
    /// handles is parked by the drainer, never silently dropped.
    static func outboxHandlers(client: ProtocolClient, executor: AuthorizedRequestExecutor) -> [any OutboxHandler] {
        TaskOutboxHandlers.make(client: client, executor: executor)
            + MediaOutboxHandlers.make(client: client, executor: executor)
    }

    /// `storage == nil` picks the production default: on disk, but in memory for hermetic UI-test launches.
    static func makeOutbox(
        storage: AedstOutbox.Storage?,
        launchMode: AppLaunchMode,
        handlers: [any OutboxHandler],
        clock: any AedstClock,
        scheduleSync: @escaping @Sendable (TimeInterval) -> Void,
        analytics: AnalyticsClient
    ) -> AedstOutbox {
        let resolved = storage ?? (launchMode == .uiTesting ? .memory : .disk)
        do {
            let outbox = try AedstOutbox(
                storage: resolved,
                handlers: handlers,
                clock: clock,
                onRetryScheduled: scheduleSync,
                // An item the drainer gave up on: report the kind only, never the payload.
                onParked: { type, error in
                    analytics.recordError(error, context: ["outbox_type": type, "outbox_event": "parked"])
                }
            )
            if let reason = outbox.memoryFallbackReason {
                // Queued writes are not durable this run (disk database unusable): make it visible.
                analytics.recordError(reason, context: ["outbox_event": "memory_fallback"])
            }
            return outbox
        } catch {
            // `.disk` already falls back to memory inside AedstOutbox; reaching here means the in-memory schema
            // itself failed to migrate, which is a programming error, not a runtime condition.
            fatalError("The outbox database could not be created: \(error)")
        }
    }

    /// The app returned to the foreground: connectivity may have changed while suspended and a BGTask may not have
    /// run, so try to deliver whatever is queued.
    func drainOutbox() {
        let coordinator = outbox.coordinator
        Task { await coordinator.drain() }
    }

    /// Reachability changed (`RootViewModel` forwards `connectivity.updates`).
    func outboxConnectivityChanged(isOnline: Bool) {
        let coordinator = outbox.coordinator
        Task { await coordinator.connectivityChanged(isOnline: isOnline) }
    }

    /// The app is going to the background with writes still queued: ask the system for a background run
    /// (iOS: `BGAppRefreshTask`; no-op elsewhere).
    func scheduleOutboxBackgroundSyncIfPending() {
        let repository = outbox.repository
        let schedule = scheduleOutboxSync
        Task {
            if (try? await repository.pendingCount()) ?? 0 > 0 {
                schedule(OutboxBackoff.default.base)
            }
        }
    }
}
