#if os(iOS)
import AedstCore
import AedstPersistence
import BackgroundTasks
import Foundation

/// Lets the system wake the app to drain the outbox while it is suspended (`BGTaskScheduler`, not a scheduler of
/// our own). A `BGAppRefreshTask` fits: a drain is a handful of short authenticated calls, not a long job.
///
/// Requirements (already in `App/iOS/Info.plist`): `BGTaskSchedulerPermittedIdentifiers` contains `identifier`
/// and `UIBackgroundModes` contains `fetch`. The system decides when the task really runs (`earliestBeginDate` is
/// only a lower bound), so foreground, reconnect and enqueue triggers remain the fast paths.
/// macOS has no `BackgroundTasks`; there the outbox drains on enqueue, reconnect and foreground only.
///
/// UNVERIFIED: never compiled or run (no Xcode here); needs a device (`e -l objc -- (void)[[BGTaskScheduler
/// sharedScheduler] _simulateLaunchForTaskWithIdentifier:...]` in the debugger) to exercise.
enum OutboxBackgroundTask {
    static let identifier = "com.aedst.apple.outbox-sync"
    private static let logger = AedstLogger(category: "outbox-bgtask")

    /// Must run before `application(_:didFinishLaunchingWithOptions:)` returns.
    static func register(coordinator: OutboxSyncCoordinator) {
        let registered = BGTaskScheduler.shared.register(forTaskWithIdentifier: identifier, using: nil) { task in
            let box = UncheckedTask(task: task)
            let work = Task {
                // `force`: the system granted a run, whatever reachability the app last observed.
                let result = await coordinator.drain(force: true)
                box.task.setTaskCompleted(success: result != .retry)
            }
            box.task.expirationHandler = { work.cancel() }
        }
        if !registered {
            logger.error("BGTaskScheduler refused the outbox task identifier (Info.plist permitted identifiers?)")
        }
    }

    /// Asks for a run no earlier than `delay` seconds from now. Replaces a pending request of the same identifier.
    static func schedule(after delay: TimeInterval) {
        let request = BGAppRefreshTaskRequest(identifier: identifier)
        request.earliestBeginDate = Date(timeIntervalSinceNow: delay)
        do {
            try BGTaskScheduler.shared.submit(request)
        } catch {
            logger.error("Could not schedule the outbox background task", error: error)
        }
    }
}

/// `BGTask` is not `Sendable`, but the system hands it to us for exactly one task and the two touches above
/// (completion, expiration) are the documented usage.
private struct UncheckedTask: @unchecked Sendable {
    let task: BGTask
}
#endif
