import AedstDesignSystem
import SwiftUI

/// Shown at the top while the device has no connection.
struct OfflineBanner: View {
    var body: some View {
        HStack(spacing: AedstSpacing.xs) {
            Image(systemName: "wifi.slash")
            Text(String(localized: "appOffline", bundle: .module))
                .aedstFont(AedstTypography.caption)
            Spacer(minLength: 0)
        }
        .padding(AedstSpacing.sm)
        .frame(maxWidth: .infinity)
        .background(AedstColor.warning)
        .foregroundStyle(AedstColor.warningForeground)
        .accessibilityElement(children: .combine)
    }
}

/// Covers the app while the biometric lock is engaged (or the app is inactive with the lock on).
struct LockView: View {
    let model: RootViewModel

    var body: some View {
        VStack(spacing: AedstSpacing.lg) {
            Image(systemName: "lock.fill")
                .font(.largeTitle)
                .accessibilityHidden(true)
            Text(String(localized: "appLocked", bundle: .module))
                .aedstFont(AedstTypography.title)
                .accessibilityAddTraits(.isHeader)
            if model.isLocked {
                AedstButton(String(localized: "appUnlock", bundle: .module)) {
                    Task { await model.unlock() }
                }
                .frame(maxWidth: 320)
            }
        }
        .padding(AedstSpacing.xxl)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(AedstColor.background)
        .accessibilityAddTraits(.isModal)
        // Prompt as soon as the lock appears (and again if it re-locks).
        .task(id: model.isLocked) {
            if model.isLocked { await model.unlock() }
        }
    }
}

/// The detail column of the split layout before anything is chosen.
struct SelectSectionPlaceholder: View {
    var body: some View {
        VStack(spacing: AedstSpacing.sm) {
            Image(systemName: "sidebar.left")
                .font(.largeTitle)
                .foregroundStyle(AedstColor.mutedForeground)
                .accessibilityHidden(true)
            Text(String(localized: "appSelectSection", bundle: .module))
                .aedstFont(AedstTypography.body)
                .foregroundStyle(AedstColor.mutedForeground)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
