import AedstAnalytics
import AedstDesignSystem
import SwiftUI

/// Content of the macOS Settings scene: the same switches as the home list's settings section, over the same
/// `PreferencesViewModel`, so changing one here is visible in the main window at once. Lives in the shared package
/// (not in the `App_macOS` target) so the strings resolve from this package's `Localizable.xcstrings`; an app target
/// has no `Bundle.module`.
public struct PreferencesView: View {
    private let dependencies: AppDependencies

    public init(dependencies: AppDependencies) {
        self.dependencies = dependencies
    }

    public var body: some View {
        let preferences = dependencies.preferences
        let analyticsEnabled = preferences.analyticsConsent == .granted
        let appLockEnabled = preferences.isAppLockEnabled
        Form {
            Section(String(localized: "appPreferencesTitle", bundle: .module)) {
                Toggle(
                    String(localized: "appShareAnalytics", bundle: .module),
                    isOn: Binding(get: { analyticsEnabled }, set: { preferences.setAnalytics(enabled: $0) })
                )
                if preferences.canOfferAppLock {
                    Toggle(
                        String(localized: "appRequireBiometrics", bundle: .module),
                        isOn: Binding(
                            get: { appLockEnabled },
                            set: { enabled in Task { await preferences.setAppLock(enabled: enabled) } }
                        )
                    )
                }
                Button(String(localized: "appEnableNotifications", bundle: .module)) {
                    Task { await dependencies.push.enablePush() }
                }
            }
        }
        .formStyle(.grouped)
        .frame(width: 440)
        .padding(AedstSpacing.lg)
        // Another window may have changed a value since this one was last shown.
        .onAppear { preferences.reload() }
    }
}
