#if os(iOS) || os(macOS) || os(visionOS)
import SwiftUI
import Testing
@testable import AedstDesignSystem

@Suite("AedstBubble")
struct AedstBubbleTests {
    @Test("ghost has no chrome and takes the full width; the others are padded and capped at 80 %")
    func ghost() {
        #expect(AedstBubbleVariant.ghost.insets == EdgeInsets())
        #expect(AedstBubbleVariant.ghost.maxWidthFraction == 1)
        for variant in AedstBubbleVariant.allCases where variant != .ghost {
            #expect(variant.maxWidthFraction == 0.8)
            #expect(variant.insets.leading == AedstSpacing.md)
        }
    }

    @Test("only outline draws a border")
    func border() {
        #expect(AedstBubbleVariant.allCases.filter(\.hasBorder) == [.outline])
    }

    @Test("a bubble follows the message's side when it has none of its own")
    func followsMessage() {
        #expect(AedstBubbleAlign(AedstMessageAlign.end) == .end)
        #expect(AedstBubbleAlign(AedstMessageAlign.start) == .start)
        #expect(AedstBubbleAlign.end.horizontal == .trailing)
    }

    @Test("reactions are pinned to the corner named by side and align")
    func reactions() {
        #expect(AedstBubbleAlign.reactionsAlignment(side: .bottom, align: .end) == .bottomTrailing)
        #expect(AedstBubbleAlign.reactionsAlignment(side: .top, align: .start) == .topLeading)
        #expect(AedstBubbleAlign.reactionsAlignment(side: .top, align: .end) == .topTrailing)
        #expect(AedstBubbleAlign.reactionsAlignment(side: .bottom, align: .start) == .bottomLeading)
    }
}
#endif
