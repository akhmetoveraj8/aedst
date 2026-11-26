#if os(iOS) || os(macOS) || os(visionOS)
import SwiftUI
import Testing
@testable import AedstDesignSystem

@Suite("AedstAlertDialog sizes")
struct AedstAlertDialogTests {
    @Test("default is wider than sm, as web max-w-sm against max-w-xs")
    func widths() {
        #expect(AedstAlertDialogSize.default.maxWidth == 384)
        #expect(AedstAlertDialogSize.sm.maxWidth == 320)
    }

    @Test("default leads in a regular window and centres in a compact one; sm always centres")
    func headerAlignment() {
        #expect(AedstAlertDialogSize.default.headerAlignment(isCompact: false) == .leading)
        #expect(AedstAlertDialogSize.default.headerAlignment(isCompact: true) == .center)
        #expect(AedstAlertDialogSize.sm.headerAlignment(isCompact: false) == .center)
        #expect(AedstAlertDialogSize.sm.headerAlignment(isCompact: true) == .center)
    }

    @Test("default stacks the actions when compact and rows them otherwise; sm uses two columns")
    func actionLayout() {
        #expect(AedstAlertDialogSize.default.actionLayout(isCompact: true) == .stacked)
        #expect(AedstAlertDialogSize.default.actionLayout(isCompact: false) == .row)
        #expect(AedstAlertDialogSize.sm.actionLayout(isCompact: true) == .columns)
        #expect(AedstAlertDialogSize.sm.actionLayout(isCompact: false) == .columns)
    }
}
#endif
