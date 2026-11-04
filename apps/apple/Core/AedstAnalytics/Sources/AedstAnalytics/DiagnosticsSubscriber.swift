import AedstCore
#if canImport(MetricKit)
import MetricKit

/// Receives Apple's on-device diagnostics — daily metric payloads and
/// diagnostic payloads (crashes, hangs, CPU/disk-write exceptions) — and
/// forwards a *scrubbed summary* to `AnalyticsClient` and the unified log.
/// MetricKit is the first-party, privacy-preserving crash/perf channel: no
/// third-party SDK, nothing leaves the device until the app's analytics
/// provider chooses to send these summaries.
///
/// Payload *contents* (call-stack trees) are intentionally not forwarded:
/// they can contain paths and are large. Use Xcode Organizer for symbolicated
/// crash reports; this gives in-app counts for alerting.
public final class DiagnosticsSubscriber: NSObject, MXMetricManagerSubscriber, Sendable {
    private let analytics: AnalyticsClient
    private let logger = AedstLogger(category: "diagnostics")

    public init(analytics: AnalyticsClient) {
        self.analytics = analytics
        super.init()
    }

    /// Call once at launch (idempotent).
    public func start() {
        MXMetricManager.shared.add(self)
    }

    public func stop() {
        MXMetricManager.shared.remove(self)
    }

    public func didReceive(_ payloads: [MXMetricPayload]) {
        for payload in payloads {
            logger.info("MetricKit metrics received for \(payload.timeStampBegin) – \(payload.timeStampEnd)")
        }
    }

    public func didReceive(_ payloads: [MXDiagnosticPayload]) {
        for payload in payloads {
            let counts = DiagnosticCounts(
                crashes: payload.crashDiagnostics?.count ?? 0,
                hangs: payload.hangDiagnostics?.count ?? 0,
                cpuExceptions: payload.cpuExceptionDiagnostics?.count ?? 0,
                diskWriteExceptions: payload.diskWriteExceptionDiagnostics?.count ?? 0
            )
            logger.error("MetricKit diagnostics: \(counts.summary)")
            analytics.track(AnalyticsEvent(name: "diagnostics_received", parameters: counts.parameters))
        }
    }
}
#endif

/// Counts extracted from a diagnostic payload (kept separate from MetricKit
/// types so it can be unit-tested on any platform).
public struct DiagnosticCounts: Sendable, Equatable {
    public let crashes: Int
    public let hangs: Int
    public let cpuExceptions: Int
    public let diskWriteExceptions: Int

    public init(crashes: Int, hangs: Int, cpuExceptions: Int, diskWriteExceptions: Int) {
        self.crashes = crashes
        self.hangs = hangs
        self.cpuExceptions = cpuExceptions
        self.diskWriteExceptions = diskWriteExceptions
    }

    public var summary: String {
        "crashes=\(crashes) hangs=\(hangs) cpu=\(cpuExceptions) diskWrites=\(diskWriteExceptions)"
    }

    /// PII-free analytics parameters (numbers only).
    public var parameters: [String: String] {
        [
            "crashes": String(crashes),
            "hangs": String(hangs),
            "cpu_exceptions": String(cpuExceptions),
            "disk_write_exceptions": String(diskWriteExceptions),
        ]
    }
}
