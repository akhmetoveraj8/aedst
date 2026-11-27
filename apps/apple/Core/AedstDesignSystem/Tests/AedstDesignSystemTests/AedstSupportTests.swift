import Foundation
import SwiftUI
import Testing
@testable import AedstDesignSystem

@Suite("AedstSafeURL")
struct AedstSafeURLTests {
    @Test("https, http and mailto pass, in any letter case")
    func allowed() {
        #expect(AedstSafeURL.parse("https://example.com/a?b=1") != nil)
        #expect(AedstSafeURL.parse("http://example.com") != nil)
        #expect(AedstSafeURL.parse("HTTPS://example.com") != nil)
        #expect(AedstSafeURL.parse("mailto:ada@example.com") != nil)
    }

    @Test("every other scheme is refused")
    func refused() {
        for text in [
            "javascript:alert(1)", "file:///etc/passwd", "data:text/html;base64,AAAA", "ftp://example.com",
            "tel:+123", "aedst://open", "vbscript:x", "intent://x#Intent;end", "//example.com", "example.com",
        ] {
            #expect(AedstSafeURL.parse(text) == nil, "should refuse \(text)")
        }
    }

    @Test("an http URL without a host is refused")
    func hostless() {
        #expect(AedstSafeURL.parse("https://") == nil)
        #expect(AedstSafeURL.parse("http:///path") == nil)
    }

    @Test("surrounding whitespace is trimmed before parsing")
    func trims() {
        #expect(AedstSafeURL.parse("  https://example.com \n") != nil)
    }

    @Test("validated returns the same URL when safe and nil otherwise")
    func validated() throws {
        let good = try #require(URL(string: "https://example.com"))
        let bad = try #require(URL(string: "javascript:alert(1)"))
        #expect(AedstSafeURL.validated(good) == good)
        #expect(AedstSafeURL.validated(bad) == nil)
        #expect(AedstSafeURL.isSafe(good))
        #expect(!AedstSafeURL.isSafe(bad))
    }
}

@Suite("AedstLayoutPolicy")
struct AedstLayoutPolicyTests {
    @Test("only the accessibility sizes stack and unlimit lines")
    func accessibilitySizes() {
        #expect(!AedstLayoutPolicy.prefersStackedLayout(.large))
        #expect(!AedstLayoutPolicy.prefersStackedLayout(.xxxLarge))
        #expect(AedstLayoutPolicy.prefersStackedLayout(.accessibility1))
        #expect(AedstLayoutPolicy.prefersStackedLayout(.accessibility5))
        #expect(AedstLayoutPolicy.lineLimit(1, for: .large) == 1)
        #expect(AedstLayoutPolicy.lineLimit(1, for: .accessibility3) == nil)
    }

    @Test("the inline sign flips in right-to-left")
    func inlineSign() {
        #expect(AedstLayoutPolicy.inlineSign(for: .leftToRight) == 1)
        #expect(AedstLayoutPolicy.inlineSign(for: .rightToLeft) == -1)
    }

    @Test("a sweep runs from before the leading edge to after the trailing edge, mirrored in RTL")
    func sweep() {
        #expect(AedstLayoutPolicy.sweepOffset(isAtEnd: false, width: 120, direction: .leftToRight) == -120)
        #expect(AedstLayoutPolicy.sweepOffset(isAtEnd: true, width: 120, direction: .leftToRight) == 120)
        #expect(AedstLayoutPolicy.sweepOffset(isAtEnd: false, width: 120, direction: .rightToLeft) == 120)
        #expect(AedstLayoutPolicy.sweepOffset(isAtEnd: true, width: 120, direction: .rightToLeft) == -120)
    }

    @Test("the sweep scales with the real width, not a constant")
    func sweepScales() {
        #expect(AedstLayoutPolicy.sweepOffset(isAtEnd: true, width: 40, direction: .leftToRight) == 40)
        #expect(AedstLayoutPolicy.sweepOffset(isAtEnd: true, width: 400, direction: .leftToRight) == 400)
    }

    @Test("a touch control is tappable at 44 pt at least; the Mac keeps its drawn height")
    func hitHeight() {
        #expect(AedstLayoutPolicy.hitHeight(drawn: 28, isTouch: true) == 44)
        #expect(AedstLayoutPolicy.hitHeight(drawn: 52, isTouch: true) == 52)
        #expect(AedstLayoutPolicy.hitHeight(drawn: 28, isTouch: false) == 28)
    }
}

@Suite("AedstInteraction")
struct AedstInteractionTests {
    @Test("pressed beats hovered, and rest is clear")
    func wash() {
        #expect(AedstInteractionOpacity.wash(isPressed: false, isHovered: false) == 0)
        #expect(AedstInteractionOpacity.wash(isPressed: false, isHovered: true) == AedstInteractionOpacity.hovered)
        #expect(AedstInteractionOpacity.wash(isPressed: true, isHovered: true) == AedstInteractionOpacity.pressed)
        #expect(AedstInteractionOpacity.pressed > AedstInteractionOpacity.hovered)
    }

    @Test("a loading button reads \"Loading\", an idle one nothing")
    @MainActor
    func buttonValue() {
        #expect(AedstButton.accessibilityValue(isLoading: false).isEmpty)
        #expect(AedstButton.accessibilityValue(isLoading: true) == AedstStrings.loading)
    }

    @Test("focus waits for the presentation to settle")
    func focusDelay() {
        #expect(AedstFocusPolicy.settleMilliseconds > 0)
    }

    @Test("all haptic kinds exist and map to feedback off tvOS")
    func haptics() {
        #expect(AedstHaptic.allCases.count == 5)
    }
}

@Suite("AedstSliderLogic")
struct AedstSliderLogicTests {
    @Test("a step moves by one step and lands on the grid")
    func steps() {
        #expect(AedstSliderLogic.moved(3, by: 1, in: 1...5, step: 1) == 4)
        #expect(AedstSliderLogic.moved(3, by: -1, in: 1...5, step: 1) == 2)
        #expect(AedstSliderLogic.moved(3.4, by: 1, in: 1...5, step: 1) == 4)
    }

    @Test("the value never leaves the range")
    func clamps() {
        #expect(AedstSliderLogic.moved(5, by: 1, in: 1...5, step: 1) == 5)
        #expect(AedstSliderLogic.moved(1, by: -1, in: 1...5, step: 1) == 1)
        #expect(AedstSliderLogic.clamped(9, to: 0...1) == 1)
        #expect(AedstSliderLogic.clamped(-9, to: 0...1) == 0)
    }

    @Test("without a step the fallback moves in tenths of the range")
    func defaultStep() {
        let moved = AedstSliderLogic.moved(0.5, by: 1, in: 0...1, step: nil)
        #expect(abs(moved - 0.6) < 0.0001)
    }

    @Test("a non-positive step is treated as no step")
    func badStep() {
        let moved = AedstSliderLogic.moved(0.5, by: 1, in: 0...1, step: 0)
        #expect(abs(moved - 0.6) < 0.0001)
    }

    @Test("an empty range stays put")
    func emptyRange() {
        #expect(AedstSliderLogic.moved(2, by: 1, in: 2...2, step: nil) == 2)
    }
}
