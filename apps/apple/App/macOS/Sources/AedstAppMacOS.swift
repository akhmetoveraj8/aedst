import AedstAppCore
import SwiftUI

@main
struct AedstAppMacOS: App {
    // The delegate owns `AppDependencies` so APNs / notification-tap callbacks
    // reach the same graph as the UI.
    @NSApplicationDelegateAdaptor(AedstAppDelegate.self) private var appDelegate

    var body: some Scene {
        // A single window, not a `WindowGroup`: session-expiry, forced-upgrade and notification-link events are
        // single-consumer streams on the shared `AppDependencies`, so a second window would silently stop
        // receiving them. The app quits with its window (`AedstAppDelegate`) for the same reason: a reopened
        // window would find the streams already ended. See decisions/apple.md, "Single window".
        Window("AEDST", id: "main") {
            RootView(dependencies: appDelegate.dependencies)
                .frame(minWidth: 720, minHeight: 480)
        }
        .commands {
            // Sidebar toggle plus one View-menu command per section (the window has a real sidebar).
            AppCommands()
        }

        // Command-comma: analytics consent, app lock, notifications. The iOS build shows these in its home list.
        Settings {
            PreferencesView(dependencies: appDelegate.dependencies)
        }
    }
}
