import AedstAppCore
import AedstDesignSystem
import NotificationsPresentation
import SwiftUI

/// The Mac sidebar: one selectable row per section the user may open. Settings are not here (they live in the
/// Settings window, `PreferencesView`); sign-out sits at the bottom of the sidebar.
struct SidebarView: View {
    let entries: [SidebarEntry]
    let badge: UnreadBadgeModel
    @Binding var selection: SidebarEntry?
    let signOut: () -> Void

    var body: some View {
        // Read observable state here (inside the body), not inside escaping closures.
        let unread = badge.unread
        List(selection: $selection) {
            ForEach(entries, id: \.self) { entry in
                HStack {
                    Label(String(localized: entry.titleKey, bundle: AppStrings.bundle), systemImage: entry.systemImage)
                    Spacer()
                    if entry == .notifications, unread > 0 {
                        AedstBadge("\(unread)")
                            .accessibilityLabel(
                                Text(String(localized: "appUnreadCount \(unread)", bundle: AppStrings.bundle))
                            )
                    }
                }
                .tag(entry)
            }
        }
        .listStyle(.sidebar)
        .navigationTitle("AEDST")
        .safeAreaInset(edge: .bottom, alignment: .leading) {
            Button(String(localized: "appSignOut", bundle: AppStrings.bundle), role: .destructive, action: signOut)
                .buttonStyle(.borderless)
                .padding(AedstSpacing.md)
        }
    }
}
