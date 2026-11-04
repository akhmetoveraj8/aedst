import SwiftUI
import Testing
@testable import AedstAppShared

@Suite("RootLayout")
struct RootLayoutTests {
    @Test("signed-out never uses the split layout")
    func signedOut() {
        #expect(!RootLayout.usesSplitView(isSignedIn: false, horizontalSizeClass: .regular, isMac: false))
        #expect(!RootLayout.usesSplitView(isSignedIn: false, horizontalSizeClass: nil, isMac: true))
    }

    @Test("iPad full screen (regular width) splits; iPhone and iPad Split View (compact) do not")
    func iOS() {
        #expect(RootLayout.usesSplitView(isSignedIn: true, horizontalSizeClass: .regular, isMac: false))
        #expect(!RootLayout.usesSplitView(isSignedIn: true, horizontalSizeClass: .compact, isMac: false))
        #expect(!RootLayout.usesSplitView(isSignedIn: true, horizontalSizeClass: nil, isMac: false))
    }

    @Test("macOS always splits when signed in")
    func macOS() {
        #expect(RootLayout.usesSplitView(isSignedIn: true, horizontalSizeClass: nil, isMac: true))
    }
}
