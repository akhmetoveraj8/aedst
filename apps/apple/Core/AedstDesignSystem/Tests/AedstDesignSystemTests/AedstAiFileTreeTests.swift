// The component exists on iOS, macOS and visionOS only (see AedstAiFileTree.swift).
#if os(iOS) || os(macOS) || os(visionOS)
import Testing
@testable import AedstDesignSystem

@Suite("AedstAiFileTree")
@MainActor
struct AedstAiFileTreeTests {
    @Test("folders open from the initial set and toggle by path")
    func expansion() {
        let state = AedstAiFileTreeState(expanded: ["src"])
        #expect(state.isExpanded("src"))
        #expect(!state.isExpanded("src/ui"))
        state.toggle("src/ui")
        #expect(state.expanded == ["src", "src/ui"])
        state.toggle("src")
        #expect(state.expanded == ["src/ui"])
    }

    @Test("setting the same open state twice is idempotent")
    func setExpanded() {
        let state = AedstAiFileTreeState()
        state.setExpanded("a", true)
        state.setExpanded("a", true)
        #expect(state.expanded == ["a"])
        state.setExpanded("a", false)
        state.setExpanded("a", false)
        #expect(state.expanded.isEmpty)
    }

    @Test("exactly one file is selected at a time")
    func selection() {
        let state = AedstAiFileTreeState(selectedPath: "a.swift")
        #expect(state.isSelected("a.swift"))
        state.selectedPath = "b.swift"
        #expect(!state.isSelected("a.swift"))
        #expect(state.isSelected("b.swift"))
    }

    @Test("the tree with folders, files and actions builds")
    func builds() {
        let state = AedstAiFileTreeState()
        _ = AedstAiFileTree(state: state, accessibilityLabel: "Changed files", onSelect: { _ in }) {
            AedstAiFileTreeFolder(path: "src", name: "src") {
                AedstAiFileTreeFile(path: "src/a.swift", name: "a.swift") { AedstBadge("M") }
            }
            AedstAiFileTreeFile(path: "Package.swift", name: "Package.swift")
        }
        _ = AedstAiFileTreeIcon("doc")
        _ = AedstAiFileTreeName("a.swift")
    }
}
#endif
