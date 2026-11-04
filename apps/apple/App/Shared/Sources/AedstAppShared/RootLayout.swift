import SwiftUI

/// Which navigation layout the signed-in app uses. Pure, so the rule is unit-tested without SwiftUI.
enum RootLayout {
    /// The split layout (sidebar + detail) needs a signed-in user and room: macOS always, iPad only at regular
    /// width (full screen; Split View and Slide Over are compact and keep the single stack, like iPhone).
    static func usesSplitView(isSignedIn: Bool, horizontalSizeClass: UserInterfaceSizeClass?, isMac: Bool) -> Bool {
        guard isSignedIn else { return false }
        return isMac || horizontalSizeClass == .regular
    }
}
