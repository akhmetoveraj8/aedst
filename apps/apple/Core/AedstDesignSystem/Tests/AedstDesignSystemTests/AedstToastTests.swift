import Testing
@testable import AedstDesignSystem

@Suite("AedstToast")
struct AedstToastTests {
    @Test("each severity has its own symbol")
    func symbols() {
        let symbols = Set(AedstToastSeverity.allCases.map(\.systemImage))
        #expect(symbols.count == AedstToastSeverity.allCases.count)
    }

    @Test("a toast is spoken as its title and message")
    func spoken() {
        let toast = AedstToastData(title: "Saved", message: "Your changes are live.", severity: .success)
        #expect(AedstAnnouncementPolicy.spokenText(title: toast.title, message: toast.message) == "Saved. Your changes are live.")
    }

    @Test("equality includes the severity, so a changed severity restarts the toast")
    func equality() {
        #expect(AedstToastData(title: "Saved", severity: .info) != AedstToastData(title: "Saved", severity: .success))
        #expect(AedstToastData(title: "Saved", severity: .success) == AedstToastData(title: "Saved", severity: .success))
        #expect(AedstToastData(title: "Saved") != AedstToastData(title: "Deleted"))
        #expect(AedstToastData(title: "Saved", message: "a") != AedstToastData(title: "Saved", message: "b"))
    }

    @Test("an upward drag past the threshold dismisses; the card only follows upward")
    func swipe() {
        #expect(AedstToastPolicy.shouldDismiss(translationHeight: -AedstToastPolicy.swipeDismissDistance))
        #expect(!AedstToastPolicy.shouldDismiss(translationHeight: -10))
        #expect(!AedstToastPolicy.shouldDismiss(translationHeight: 80))
        #expect(AedstToastPolicy.dragOffset(translationHeight: 30) == 0)
        #expect(AedstToastPolicy.dragOffset(translationHeight: -30) == -30)
    }

    @Test("the countdown waits for hover, touch, keyboard focus or VoiceOver focus")
    func pause() {
        #expect(!AedstToastPolicy.isPaused(isHovering: false, isTouching: false, hasKeyboardFocus: false, hasAccessibilityFocus: false))
        #expect(AedstToastPolicy.isPaused(isHovering: true, isTouching: false, hasKeyboardFocus: false, hasAccessibilityFocus: false))
        #expect(AedstToastPolicy.isPaused(isHovering: false, isTouching: true, hasKeyboardFocus: false, hasAccessibilityFocus: false))
        #expect(AedstToastPolicy.isPaused(isHovering: false, isTouching: false, hasKeyboardFocus: true, hasAccessibilityFocus: false))
        #expect(AedstToastPolicy.isPaused(isHovering: false, isTouching: false, hasKeyboardFocus: false, hasAccessibilityFocus: true))
    }

    @Test("only an error moves VoiceOver focus; the others are announced")
    func focus() {
        #expect(AedstToastPolicy.movesAccessibilityFocus(for: .destructive))
        for severity in [AedstToastSeverity.info, .success, .warning] {
            #expect(!AedstToastPolicy.movesAccessibilityFocus(for: severity))
        }
    }

    @Test("haptics follow the severity; info is silent")
    func haptics() {
        #expect(AedstHaptic.toast(.info) == nil)
        #expect(AedstHaptic.toast(.success) == .success)
        #expect(AedstHaptic.toast(.warning) == .warning)
        #expect(AedstHaptic.toast(.destructive) == .error)
    }

    @Test("VoiceOver keeps a toast at least eight seconds")
    func voiceOverDuration() {
        #expect(AedstAnnouncementPolicy.displayDuration(base: 3, voiceOverRunning: true) >= 8)
        #expect(AedstAnnouncementPolicy.displayDuration(base: 3, voiceOverRunning: false) == 3)
    }

    @Test("the dismiss button has a localized label")
    func dismissLabel() {
        #expect(!AedstStrings.dismissNotification.isEmpty)
        #expect(!AedstStrings.dismissNotification.hasPrefix("ds"))
    }
}
