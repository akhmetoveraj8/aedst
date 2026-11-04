import Testing
@testable import AedstDesignSystem

@Suite("AedstAnnouncementPolicy")
struct AedstAnnouncementPolicyTests {
    @Test("a toast keeps its duration without VoiceOver and is longer with it")
    func duration() {
        #expect(AedstAnnouncementPolicy.displayDuration(base: 3, voiceOverRunning: false) == 3)
        #expect(AedstAnnouncementPolicy.displayDuration(base: 3, voiceOverRunning: true) == 9)
        #expect(AedstAnnouncementPolicy.displayDuration(base: 1, voiceOverRunning: true) == 8)
    }

    @Test("the spoken toast is the title, then the message when present")
    func spoken() {
        #expect(AedstAnnouncementPolicy.spokenText(title: "Saved", message: nil) == "Saved")
        #expect(AedstAnnouncementPolicy.spokenText(title: "Saved", message: "") == "Saved")
        #expect(AedstAnnouncementPolicy.spokenText(title: "Saved", message: "Live now") == "Saved. Live now")
    }

    @Test("only a new, non-empty inline error is announced")
    func inlineError() {
        #expect(AedstAnnouncementPolicy.announcement(previous: nil, current: "Required") == "Required")
        #expect(AedstAnnouncementPolicy.announcement(previous: "Required", current: "Required") == nil)
        #expect(AedstAnnouncementPolicy.announcement(previous: "Required", current: nil) == nil)
        #expect(AedstAnnouncementPolicy.announcement(previous: nil, current: "") == nil)
        #expect(AedstAnnouncementPolicy.announcement(previous: "A", current: "B") == "B")
    }
}
