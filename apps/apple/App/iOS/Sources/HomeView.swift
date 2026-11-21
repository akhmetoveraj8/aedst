import AedstDesignSystem
import Notifications
import SwiftUI

/// One entry of the signed-in home list.
enum HomeEntry {
    case tasks, search, notifications, media, admin
}

/// Signed-in home: one entry per feature, plus account settings. The root screen of the compact layout and the
/// sidebar of the split layout (iPad regular width, macOS); `select` decides whether an entry pushes or replaces.
struct HomeView: View {
    let model: RootViewModel
    let badge: UnreadBadgeModel
    let select: (HomeEntry) -> Void

    var body: some View {
        // Read observable state here (inside the body), not inside escaping closures.
        let isAppLockEnabled = model.isAppLockEnabled
        let analyticsEnabled = model.analyticsConsent == .granted
        List {
            Section {
                if model.isFeatureEnabled(AppFeature.tasks) {
                    entry("appHomeTasks", "checklist", shortcut: "1") { select(.tasks) }
                }
                if model.isFeatureEnabled(AppFeature.search) {
                    entry("appHomeSearch", "magnifyingglass", shortcut: "f") { select(.search) }
                }
                if model.isFeatureEnabled(AppFeature.notifications) {
                    Button {
                        select(.notifications)
                    } label: {
                        HStack {
                            Label(String(localized: "appHomeNotifications", bundle: .module), systemImage: "bell")
                            Spacer()
                            if badge.unread > 0 {
                                AedstBadge("\(badge.unread)")
                                    .accessibilityLabel(
                                        Text(String(localized: "appUnreadCount \(badge.unread)", bundle: .module))
                                    )
                            }
                        }
                    }
                    .keyboardShortcut("2", modifiers: .command)
                }
                if model.isFeatureEnabled(AppFeature.media) {
                    entry("appHomeFiles", "photo.on.rectangle", shortcut: "3") { select(.media) }
                }
                // Admin is both role-gated (UX only) and flagged: hidden until the server enables it.
                if model.isAdmin, model.isFeatureEnabled(AppFeature.admin) {
                    entry("appHomeAdmin", "shield", shortcut: "4") { select(.admin) }
                }
            }

            Section(String(localized: "appSettings", bundle: .module)) {
                Button(String(localized: "appEnableNotifications", bundle: .module)) {
                    Task { await model.enablePushNotifications() }
                }
                Toggle(
                    String(localized: "appShareAnalytics", bundle: .module),
                    isOn: Binding(get: { analyticsEnabled }, set: { model.setAnalytics(enabled: $0) })
                )
                if model.canOfferAppLock {
                    Toggle(
                        String(localized: "appRequireBiometrics", bundle: .module),
                        isOn: Binding(
                            get: { isAppLockEnabled },
                            set: { enabled in Task { await model.setAppLock(enabled: enabled) } }
                        )
                    )
                }
                Button(String(localized: "appSignOut", bundle: .module), role: .destructive) {
                    Task { await model.signOut() }
                }
            }
        }
        .navigationTitle("AEDST")
    }

    private func entry(
        _ key: String.LocalizationValue,
        _ icon: String,
        shortcut: KeyEquivalent,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Label(String(localized: key, bundle: .module), systemImage: icon)
        }
        .keyboardShortcut(shortcut, modifiers: .command)
    }
}
