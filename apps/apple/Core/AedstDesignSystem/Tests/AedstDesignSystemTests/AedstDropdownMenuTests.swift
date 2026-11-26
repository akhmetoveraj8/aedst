#if os(iOS) || os(macOS) || os(visionOS)
import SwiftUI
import Testing
@testable import AedstDesignSystem

@Suite("AedstDropdownMenu and AedstContextMenu item variants")
struct AedstDropdownMenuTests {
    @Test("a destructive item becomes the system destructive role, a default item has none")
    func roles() {
        #expect(AedstMenuItemVariant.default.buttonRole == nil)
        #expect(AedstMenuItemVariant.destructive.buttonRole == .destructive)
    }

    @Test("an action keeps its variant; separators and groups are default")
    func itemVariant() {
        #expect(AedstMenuItem.action("Delete", variant: .destructive) {}.variant == .destructive)
        #expect(AedstMenuItem.action("Copy") {}.variant == .default)
        #expect(AedstMenuItem.separator.variant == .default)
        #expect(AedstMenuItem.section(items: []).variant == .default)
    }

    @Test("a checkbox entry is never destructive")
    func checkboxVariant() {
        #expect(AedstMenuItem.checkbox("Bold", isOn: true) {}.variant == .default)
    }
}
#endif
