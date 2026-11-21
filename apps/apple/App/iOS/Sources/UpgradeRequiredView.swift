import AedstDesignSystem
import SwiftUI

/// Blocking screen shown when the server rejects this app version (`CLIENT_UPGRADE_REQUIRED`, ADR-0009,
/// behaviour `forced-upgrade-ux`). It covers the whole app (like `LockView`) and has no dismiss action: the only
/// way forward is to update. Without a configured App Store ID the button is hidden, the message still shows.
struct UpgradeRequiredView: View {
    let appStoreURL: URL?
    @Environment(\.openURL) private var openURL

    var body: some View {
        VStack(spacing: AedstSpacing.lg) {
            Image(systemName: "arrow.down.app.fill")
                .font(.largeTitle)
                .accessibilityHidden(true)
            Text(String(localized: "appUpgradeTitle", bundle: .module))
                .aedstFont(AedstTypography.title)
                .accessibilityAddTraits(.isHeader)
            Text(String(localized: "appUpgradeMessage", bundle: .module))
                .aedstFont(AedstTypography.body)
                .foregroundStyle(AedstColor.mutedForeground)
                .multilineTextAlignment(.center)
            if let appStoreURL {
                AedstButton(String(localized: "appUpgradeButton", bundle: .module)) {
                    openURL(appStoreURL)
                }
                .frame(maxWidth: 320)
                .accessibilityIdentifier("upgrade.openAppStore")
            }
        }
        .padding(AedstSpacing.xxl)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(AedstColor.background)
        .accessibilityElement(children: .contain)
        .accessibilityAddTraits(.isModal)
        .accessibilityIdentifier("upgrade.required")
    }
}
