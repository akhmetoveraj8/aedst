import SwiftUI

// iOS, macOS and visionOS only: tvOS and watchOS are scaffolded package platforms without app targets.
#if os(iOS) || os(macOS) || os(visionOS)

/// Result of one test (or a suite, a run), as on web.
public enum AedstAiTestStatus: String, Sendable, CaseIterable {
    case passed
    case failed
    case skipped
    case running

    /// Line status: success, error, skipped, running.
    public var status: AedstTraceStatus {
        switch self {
        case .passed: .success
        case .failed: .error
        case .skipped: .skipped
        case .running: .running
        }
    }
}

/// Totals for a summary the caller words ("Ran 5 tests, 1 failed").
public struct AedstAiTestCounts: Sendable, Equatable {
    public var total: Int
    public var passed: Int
    public var failed: Int
    public var skipped: Int

    public init(total: Int = 0, passed: Int = 0, failed: Int = 0, skipped: Int = 0) {
        self.total = total
        self.passed = passed
        self.failed = failed
        self.skipped = skipped
    }

    /// Counts a list of results; running tests count only towards the total (web `countTests`).
    public init(_ statuses: [AedstAiTestStatus]) {
        self.init()
        for status in statuses {
            total += 1
            switch status {
            case .passed: passed += 1
            case .failed: failed += 1
            case .skipped: skipped += 1
            case .running: break
            }
        }
    }

    /// Share of passed tests, 0...1 (0 for an empty run).
    public var passedFraction: Double {
        Double(passed) / Double(max(total, 1))
    }
}

/// A test run, matching the web `AiTestResults`: a summary line that opens into `AedstAiTestResultsProgress` and
/// `AedstAiTestSuites` of `AedstAiTestSuite`s with their `AedstAiTest`s.
public struct AedstAiTestResults<Content: View>: View {
    private let title: String
    private let status: AedstAiTestStatus
    private let systemImage: String
    private let initiallyExpanded: Bool
    private let content: Content

    /// - Parameter title: The summary, worded by the caller ("Ran 5 tests, 1 failed").
    public init(
        _ title: String,
        status: AedstAiTestStatus,
        systemImage: String = "flask",
        initiallyExpanded: Bool = false,
        @ViewBuilder content: () -> Content
    ) {
        self.title = title
        self.status = status
        self.systemImage = systemImage
        self.initiallyExpanded = initiallyExpanded
        self.content = content()
    }

    public var body: some View {
        AedstAiChainOfThought(initiallyExpanded: initiallyExpanded) {
            AedstAiTestResultsHeader(title, status: status, systemImage: systemImage)
        } content: {
            content
        }
    }
}

/// The summary line; a passed run keeps its icon, a failed one shows the error status.
public struct AedstAiTestResultsHeader: View {
    private let title: String
    private let status: AedstAiTestStatus
    private let systemImage: String

    public init(_ title: String, status: AedstAiTestStatus, systemImage: String = "flask") {
        self.title = title
        self.status = status
        self.systemImage = systemImage
    }

    public var body: some View {
        AedstAiChainOfThoughtHeader(
            title, systemImage: systemImage, status: AedstAiTestResultsLogic.headerStatus(status)
        )
    }
}

/// Pure rules of the test results, unit-tested.
enum AedstAiTestResultsLogic {
    /// The run line: success keeps the caller icon, every other result shows its status.
    static func headerStatus(_ status: AedstAiTestStatus) -> AedstTraceStatus? {
        status == .passed ? nil : status.status
    }

    /// A suite line shows only failure and progress; passed and skipped suites keep the file icon.
    static func suiteStatus(_ status: AedstAiTestStatus) -> AedstTraceStatus? {
        status == .failed || status == .running ? status.status : nil
    }

    /// Suites with a failure open by default.
    static func suiteOpensInitially(_ status: AedstAiTestStatus, explicit: Bool?) -> Bool {
        explicit ?? (status == .failed)
    }

    /// A failed test with a message is a collapsible line; every other test a plain step.
    static func isExpandable(_ status: AedstAiTestStatus, error: String?) -> Bool {
        status == .failed && !(error ?? "").isEmpty
    }
}

/// Share of passed tests as a bar with a label and the percentage.
public struct AedstAiTestResultsProgress: View {
    private let counts: AedstAiTestCounts
    private let label: String

    /// - Parameter label: Visible label, e.g. "Passed".
    public init(counts: AedstAiTestCounts, label: String) {
        self.counts = counts
        self.label = label
    }

    public var body: some View {
        let percent = counts.passedFraction.formatted(.percent.precision(.fractionLength(0)))
        VStack(alignment: .leading, spacing: AedstSpacing.xs) {
            HStack {
                Text(label)
                Spacer(minLength: AedstSpacing.sm)
                Text(percent).monospacedDigit()
            }
            .font(AedstTypography.caption.weight(.medium))
            .foregroundStyle(AedstColor.mutedForeground)
            .accessibilityHidden(true)
            AedstProgressView(value: counts.passedFraction)
                .accessibilityLabel(Text(label))
                .accessibilityValue(Text(percent))
        }
        .padding(.horizontal, AedstSpacing.sm)
    }
}

/// The list of suites.
public typealias AedstAiTestSuites<Content: View> = AedstAiChainOfThoughtSteps<Content>

/// A file of tests; suites with a failure open by default.
public struct AedstAiTestSuite<Content: View>: View {
    private let name: String
    private let status: AedstAiTestStatus
    private let statusLabel: String?
    private let initiallyExpanded: Bool?
    private let content: Content

    /// - Parameter name: Suite title with its counts, e.g. "payment.test.ts, 2 tests, 1 failed".
    public init(
        _ name: String,
        status: AedstAiTestStatus,
        statusLabel: String? = nil,
        initiallyExpanded: Bool? = nil,
        @ViewBuilder content: () -> Content
    ) {
        self.name = name
        self.status = status
        self.statusLabel = statusLabel
        self.initiallyExpanded = initiallyExpanded
        self.content = content()
    }

    public var body: some View {
        AedstAiChainOfThought(
            initiallyExpanded: AedstAiTestResultsLogic.suiteOpensInitially(status, explicit: initiallyExpanded)
        ) {
            AedstAiChainOfThoughtHeader(
                name, systemImage: "doc.text", status: AedstAiTestResultsLogic.suiteStatus(status), statusLabel: statusLabel
            )
        } content: {
            AedstAiChainOfThoughtSteps { content }
        }
    }
}

/// One test: a step with its duration, or, when it failed with a message, an open line with the message.
public struct AedstAiTest: View {
    private let name: String
    private let status: AedstAiTestStatus
    private let error: String?
    private let duration: String?
    private let statusLabel: String?
    private let showsCopyButton: Bool

    /// - Parameters:
    ///   - error: Failure message.
    ///   - duration: Already formatted, e.g. "12 ms".
    ///   - statusLabel: The status in words for VoiceOver ("Failed").
    public init(
        _ name: String,
        status: AedstAiTestStatus,
        error: String? = nil,
        duration: String? = nil,
        statusLabel: String? = nil,
        showsCopyButton: Bool = true
    ) {
        self.name = name
        self.status = status
        self.error = error
        self.duration = duration
        self.statusLabel = statusLabel
        self.showsCopyButton = showsCopyButton
    }

    public var body: some View {
        if AedstAiTestResultsLogic.isExpandable(status, error: error), let error {
            AedstAiChainOfThought(initiallyExpanded: true) {
                AedstAiChainOfThoughtHeader(
                    name, systemImage: "xmark", status: .error, statusLabel: statusLabel, description: duration
                )
            } content: {
                AedstCodeBlock(error, wrapsByDefault: true, showsWrapToggle: false, showsCopyButton: showsCopyButton, highlightsSyntax: false)
                    .frame(maxHeight: AedstAiToolLayout.maxCodeHeight)
            }
        } else {
            AedstAiChainOfThoughtStep(name, description: duration, status: status.status, statusLabel: statusLabel)
        }
    }
}

#Preview("AedstAiTestResults") {
    let statuses: [AedstAiTestStatus] = [.passed, .passed, .failed, .skipped]
    AedstAiTestResults("Ran 4 tests, 1 failed", status: .failed, initiallyExpanded: true) {
        AedstAiTestResultsProgress(counts: AedstAiTestCounts(statuses), label: "Passed")
        AedstAiTestSuites {
            AedstAiTestSuite("payment.test.ts, 3 tests, 1 failed", status: .failed) {
                AedstAiTest("charges the card", status: .passed, duration: "12 ms")
                AedstAiTest("refunds", status: .failed, error: "Expected 200, received 500", duration: "40 ms", statusLabel: "Failed")
                AedstAiTest("retries", status: .skipped, statusLabel: "Skipped")
            }
            AedstAiTestSuite("cart.test.ts, 1 test", status: .passed) {
                AedstAiTest("adds an item", status: .passed, duration: "3 ms")
            }
        }
    }
    .padding()
}

#endif
