import AedstAnalytics
import AedstAppCore
import AedstDesignSystem
import SwiftUI

/// Content of the macOS Settings scene (Command-comma): the switches the iOS build shows in its home list, over the
/// same `PreferencesViewModel` (`AedstAppCore`). Part of the `App_macOS` target; strings come from the app-shell
/// catalog through `AppStrings.bundle`.
struct PreferencesView: View {
    let dependencies: AppDependencies

    var body: some View {
        let preferences = dependencies.preferences
        let analyticsEnabled = preferences.analyticsConsent == .granted
        let appLockEnabled = preferences.isAppLockEnabled
        Form {
            Section(String(localized: "appPreferencesTitle", bundle: AppStrings.bundle)) {
                Toggle(
                    String(localized: "appShareAnalytics", bundle: AppStrings.bundle),
                    isOn: Binding(get: { analyticsEnabled }, set: { preferences.setAnalytics(enabled: $0) })
                )
                if preferences.canOfferAppLock {
                    Toggle(
                        String(localized: "appRequireBiometrics", bundle: AppStrings.bundle),
                        isOn: Binding(
                            get: { appLockEnabled },
                            set: { enabled in Task { await preferences.setAppLock(enabled: enabled) } }
                        )
                    )
                }
                Button(String(localized: "appEnableNotifications", bundle: AppStrings.bundle)) {
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
