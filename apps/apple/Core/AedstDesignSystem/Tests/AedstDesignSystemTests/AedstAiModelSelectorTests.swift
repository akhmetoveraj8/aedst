#if os(iOS) || os(macOS) || os(visionOS)
import SwiftUI
import Testing
@testable import AedstDesignSystem

@Suite("AedstAiModelSelector")
@MainActor
struct AedstAiModelSelectorTests {
    private let groups = [
        AedstAiModelSelectorGroup(heading: "Anthropic", models: [
            AedstAiModelSelectorItem(id: "fast", name: "Fast"),
            AedstAiModelSelectorItem(id: "smart", name: "Smart"),
        ]),
        AedstAiModelSelectorGroup(models: [AedstAiModelSelectorItem(id: "local", name: "On device")]),
    ]

    @Test("the selected model is found across groups; an unknown id finds nothing")
    func lookup() {
        #expect(AedstAiModelSelector.model(withID: "local", in: groups)?.name == "On device")
        #expect(AedstAiModelSelector.model(withID: "missing", in: groups) == nil)
    }

    @Test("one section per group, one checked entry for the selection")
    func menuItems() {
        let items = AedstAiModelSelector.menuItems(groups: groups, selection: "smart") { _ in }
        #expect(items.count == 2)
        guard case .section(let first) = items[0].content else {
            Issue.record("expected a section")
            return
        }
        #expect(items[0].title == "Anthropic")
        let checked = first.compactMap { item -> String? in
            if case .checkbox(let isOn, _) = item.content, isOn { return item.title }
            return nil
        }
        #expect(checked == ["Smart"])
    }

    @Test("picking an entry reports its model id")
    func picking() {
        var picked: String?
        let items = AedstAiModelSelector.menuItems(groups: groups, selection: "fast") { picked = $0 }
        guard case .section(let first) = items[0].content, case .checkbox(_, let toggle) = first[1].content else {
            Issue.record("expected a checkbox entry")
            return
        }
        toggle()
        #expect(picked == "smart")
    }

    @Test("a group without a heading is identified by its models")
    func groupIdentity() {
        #expect(groups[1].id == "local")
        #expect(groups[0].id == "Anthropic")
    }
}
#endif
