import AedstAppShared
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
            // The main window has a real sidebar (split layout), so the toggle-sidebar command applies.
            SidebarCommands()
        }

        Settings {
            PreferencesView(dependencies: appDelegate.dependencies)
        }
    }
}
