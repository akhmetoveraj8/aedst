import SwiftUI
import Testing
@testable import AedstDesignSystem

@Suite("AedstDisabledStyle")
struct AedstDisabledStyleTests {
    @Test("enabled keeps the colour the control passed")
    func enabledKeeps() {
        #expect(AedstDisabledStyle.foreground(AedstColor.foreground, isDisabled: false) == AedstColor.foreground)
        #expect(AedstDisabledStyle.border(AedstColor.border, isDisabled: false) == AedstColor.border)
        #expect(AedstDisabledStyle.fill(AedstColor.background, isDisabled: false) == AedstColor.background)
        #expect(AedstDisabledStyle.mark(AedstColor.primary, isDisabled: false) == AedstColor.primary)
        #expect(AedstDisabledStyle.onMark(AedstColor.primaryForeground, isDisabled: false) == AedstColor.primaryForeground)
    }

    @Test("disabled swaps in the muted tokens, whatever colour was passed")
    func disabledUsesTokens() {
        #expect(AedstDisabledStyle.foreground(AedstColor.destructive, isDisabled: true) == AedstColor.mutedForeground)
        #expect(AedstDisabledStyle.border(AedstColor.primary, isDisabled: true) == AedstColor.input)
        #expect(AedstDisabledStyle.fill(AedstColor.background, isDisabled: true) == AedstColor.muted)
        #expect(AedstDisabledStyle.mark(AedstColor.primary, isDisabled: true) == AedstColor.mutedForeground)
        #expect(AedstDisabledStyle.onMark(AedstColor.primaryForeground, isDisabled: true) == AedstColor.muted)
    }
}

@Suite("AedstFocusReturnPolicy")
struct AedstFocusReturnPolicyTests {
    @Test("focus returns only when a presentation goes from shown to hidden")
    func transitions() {
        #expect(AedstFocusReturnPolicy.shouldReturn(wasPresented: true, isPresented: false))
        #expect(!AedstFocusReturnPolicy.shouldReturn(wasPresented: false, isPresented: true))
        #expect(!AedstFocusReturnPolicy.shouldReturn(wasPresented: false, isPresented: false))
        #expect(!AedstFocusReturnPolicy.shouldReturn(wasPresented: true, isPresented: true))
    }
}
