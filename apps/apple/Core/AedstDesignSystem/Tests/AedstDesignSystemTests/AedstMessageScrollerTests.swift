#if os(iOS) || os(macOS) || os(visionOS)
import Testing
@testable import AedstDesignSystem

@Suite("AedstMessageScroller")
struct AedstMessageScrollerTests {
    private typealias Policy = AedstMessageScrollerPolicy

    @Test("the distance to the end accounts for the visible height and the bottom inset")
    func distance() {
        #expect(Policy.distanceToEnd(contentHeight: 1000, offsetY: 600, visibleHeight: 400) == 0)
        #expect(Policy.distanceToEnd(contentHeight: 1000, offsetY: 300, visibleHeight: 400) == 300)
        #expect(Policy.distanceToEnd(contentHeight: 1000, offsetY: 600, visibleHeight: 400, bottomInset: 20) == 20)
        #expect(Policy.distanceToEnd(contentHeight: 100, offsetY: 0, visibleHeight: 400) == 0)
    }

    @Test("within the threshold counts as at the end, so the jump button stays hidden")
    func atEnd() {
        #expect(Policy.isAtEnd(distanceToEnd: 0))
        #expect(Policy.isAtEnd(distanceToEnd: Policy.endThreshold))
        #expect(!Policy.isAtEnd(distanceToEnd: Policy.endThreshold + 1))
    }

    @Test("nothing is announced on the first load, for the same message or while it streams")
    func silent() {
        #expect(Policy.announcement(previousLastID: nil, lastID: 1, isStreaming: false, isAtEnd: true, text: "Hi") == nil)
        #expect(Policy.announcement(previousLastID: 1, lastID: 1, isStreaming: false, isAtEnd: true, text: "Hi") == nil)
        #expect(Policy.announcement(previousLastID: 1, lastID: 2, isStreaming: true, isAtEnd: true, text: "Hi") == nil)
    }

    @Test("a new message is spoken with the caller's text, or as New message while reading older ones")
    func spoken() {
        #expect(Policy.announcement(previousLastID: 1, lastID: 2, isStreaming: false, isAtEnd: true, text: "Hi") == "Hi")
        #expect(Policy.announcement(previousLastID: 1, lastID: 2, isStreaming: false, isAtEnd: false, text: nil) == AedstStrings.newMessage)
        #expect(Policy.announcement(previousLastID: 1, lastID: 2, isStreaming: false, isAtEnd: true, text: nil) == nil)
    }
}
#endif
