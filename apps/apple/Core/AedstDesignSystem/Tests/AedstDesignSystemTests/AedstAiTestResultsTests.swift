// The component exists on iOS, macOS and visionOS only (see AedstAiTestResults.swift).
#if os(iOS) || os(macOS) || os(visionOS)
import Testing
@testable import AedstDesignSystem

@Suite("AedstAiTestResults")
struct AedstAiTestResultsTests {
    @Test("counts add up and running tests count only towards the total")
    func counts() {
        let counts = AedstAiTestCounts([.passed, .passed, .failed, .skipped, .running])
        #expect(counts == AedstAiTestCounts(total: 5, passed: 2, failed: 1, skipped: 1))
    }

    @Test("the passed share is 0 for an empty run and a fraction otherwise")
    func passedFraction() {
        #expect(AedstAiTestCounts([AedstAiTestStatus]()).passedFraction == 0)
        #expect(AedstAiTestCounts([.passed, .failed, .passed, .passed]).passedFraction == 0.75)
    }

    @Test("results map to the trace statuses")
    func statuses() {
        #expect(AedstAiTestStatus.passed.status == .success)
        #expect(AedstAiTestStatus.failed.status == .error)
        #expect(AedstAiTestStatus.skipped.status == .skipped)
        #expect(AedstAiTestStatus.running.status == .running)
    }

    @Test("a passed run keeps its icon; suites show only failure and progress")
    func lineStatuses() {
        #expect(AedstAiTestResultsLogic.headerStatus(.passed) == nil)
        #expect(AedstAiTestResultsLogic.headerStatus(.failed) == .error)
        #expect(AedstAiTestResultsLogic.suiteStatus(.skipped) == nil)
        #expect(AedstAiTestResultsLogic.suiteStatus(.running) == .running)
    }

    @Test("failed suites open by default unless the caller says otherwise")
    func suiteOpening() {
        #expect(AedstAiTestResultsLogic.suiteOpensInitially(.failed, explicit: nil))
        #expect(!AedstAiTestResultsLogic.suiteOpensInitially(.passed, explicit: nil))
        #expect(!AedstAiTestResultsLogic.suiteOpensInitially(.failed, explicit: false))
    }

    @Test("only a failed test with a message is collapsible")
    func expandable() {
        #expect(AedstAiTestResultsLogic.isExpandable(.failed, error: "Expected 1"))
        #expect(!AedstAiTestResultsLogic.isExpandable(.failed, error: nil))
        #expect(!AedstAiTestResultsLogic.isExpandable(.failed, error: ""))
        #expect(!AedstAiTestResultsLogic.isExpandable(.passed, error: "ignored"))
    }

    @Test("the results with progress, suites and tests build")
    @MainActor
    func builds() {
        _ = AedstAiTestResults("Ran 2 tests, 1 failed", status: .failed) {
            AedstAiTestResultsProgress(counts: AedstAiTestCounts([.passed, .failed]), label: "Passed")
            AedstAiTestSuites {
                AedstAiTestSuite("a.test.ts", status: .failed) {
                    AedstAiTest("works", status: .passed, duration: "2 ms")
                    AedstAiTest("fails", status: .failed, error: "Expected 1", statusLabel: "Failed")
                }
            }
        }
        _ = AedstAiTestResultsHeader("Running tests", status: .running)
    }
}
#endif
