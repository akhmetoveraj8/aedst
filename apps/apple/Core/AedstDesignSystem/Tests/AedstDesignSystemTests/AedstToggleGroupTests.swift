// The components exist on iOS, macOS and visionOS only (see AedstToggleGroup.swift, AedstAccordion.swift).
#if os(iOS) || os(macOS) || os(visionOS)
import Testing
@testable import AedstDesignSystem

@Suite("AedstToggleGroup and AedstAccordion selection")
struct AedstToggleGroupTests {
    @Test("single selection: another item replaces the selection, the same item clears it")
    func singleSelection() {
        #expect(AedstToggleGroupLogic.toggledSingle("b", current: "a") == "b")
        #expect(AedstToggleGroupLogic.toggledSingle("a", current: "a") == nil)
        #expect(AedstToggleGroupLogic.toggledSingle("a", current: nil) == "a")
    }

    @Test("multiple selection: an item is added or removed, the others stay")
    func multipleSelection() {
        #expect(AedstToggleGroupLogic.toggledMultiple("b", current: ["a"]) == ["a", "b"])
        #expect(AedstToggleGroupLogic.toggledMultiple("a", current: ["a", "b"]) == ["b"])
    }

    @Test("a single-mode accordion keeps one section open")
    func accordionSingle() {
        #expect(AedstAccordionLogic.toggled("b", in: ["a"], mode: .single) == ["b"])
        #expect(AedstAccordionLogic.toggled("a", in: ["a"], mode: .single).isEmpty)
    }

    @Test("a multiple-mode accordion opens sections independently")
    func accordionMultiple() {
        #expect(AedstAccordionLogic.toggled("b", in: ["a"], mode: .multiple) == ["a", "b"])
        #expect(AedstAccordionLogic.toggled("a", in: ["a", "b"], mode: .multiple) == ["b"])
    }
}
#endif
