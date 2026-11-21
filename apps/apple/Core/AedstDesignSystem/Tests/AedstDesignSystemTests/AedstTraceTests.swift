// The component exists on iOS, macOS and visionOS only (see AedstTrace.swift).
#if os(iOS) || os(macOS) || os(visionOS)
import Testing
@testable import AedstDesignSystem

@Suite("AedstTrace")
struct AedstTraceTests {
    private let labels = AedstTraceStatusLabels(
        pending: "Pending", running: "Running", success: "Succeeded", error: "Failed", skipped: "Skipped"
    )

    private func tree(search: AedstTraceStatus, grep: AedstTraceStatus) -> [AedstTraceStep] {
        [
            AedstTraceStep(id: "plan", title: "Plan", status: .success),
            AedstTraceStep(
                id: "search",
                title: "Search",
                status: search,
                children: [AedstTraceStep(id: "grep", title: "grep", status: grep)]
            ),
        ]
    }

    @Test("flatten lists parents before their children, depth first")
    func flattens() {
        let ids = AedstTraceLogic.flatten(tree(search: .running, grep: .pending)).map(\.id)
        #expect(ids == ["plan", "search", "grep"])
    }

    @Test("the first render announces nothing")
    func firstRenderIsSilent() {
        let steps = tree(search: .running, grep: .pending)
        #expect(AedstTraceLogic.announcement(previous: nil, steps: steps, labels: labels) == nil)
    }

    @Test("only steps whose status changed are announced, nested ones included")
    func announcesChanges() {
        let before = AedstTraceLogic.statuses(tree(search: .running, grep: .running))
        let after = tree(search: .success, grep: .error)
        let text = AedstTraceLogic.announcement(previous: before, steps: after, labels: labels)
        #expect(text == "Search: Succeeded. grep: Failed")
    }

    @Test("an unchanged tree and a brand-new step announce nothing")
    func ignoresUnchangedAndNew() {
        let steps = tree(search: .running, grep: .pending)
        let before = AedstTraceLogic.statuses(steps)
        #expect(AedstTraceLogic.announcement(previous: before, steps: steps, labels: labels) == nil)

        let added = steps + [AedstTraceStep(id: "edit", title: "Edit", status: .running)]
        #expect(AedstTraceLogic.announcement(previous: before, steps: added, labels: labels) == nil)
    }

    @Test("running and failed steps open by default; an explicit value wins")
    func initialExpansion() {
        #expect(AedstTraceStep(id: "a", title: "A", status: .running).opensInitially)
        #expect(AedstTraceStep(id: "a", title: "A", status: .error).opensInitially)
        #expect(!AedstTraceStep(id: "a", title: "A", status: .success).opensInitially)
        #expect(!AedstTraceStep(id: "a", title: "A", status: .error, isInitiallyExpanded: false).opensInitially)
    }

    @Test("the built-in status labels resolve from the catalog")
    func localizedLabels() {
        for status in AedstTraceStatus.allCases {
            let text = AedstTraceStatusLabels.localized.label(for: status)
            #expect(!text.isEmpty)
            #expect(!text.hasPrefix("ds"), "unresolved localization key: \(text)")
        }
    }
}
#endif
