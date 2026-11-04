import AedstAppShared
import SwiftUI

@main
struct AedstAppIOS: App {
    // The delegate owns `AppDependencies` so APNs / notification-tap /
    // background-upload callbacks reach the same graph as the UI.
    @UIApplicationDelegateAdaptor(AedstAppDelegate.self) private var appDelegate

    var body: some Scene {
        WindowGroup {
            RootView(dependencies: appDelegate.dependencies)
        }
    }
}
