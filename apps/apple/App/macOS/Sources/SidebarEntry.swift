import AedstAppCore
import SwiftUI

/// One section of the Mac sidebar. The same list drives the sidebar rows and the View menu commands, so a section
/// can never be reachable from one and missing from the other.
enum SidebarEntry: Hashable, CaseIterable {
    case tasks, search, notifications, media, admin

    /// Key in the app-shell String Catalog (`AppStrings.bundle`).
    var titleKey: String.LocalizationValue {
        switch self {
        case .tasks: "appHomeTasks"
        case .search: "appHomeSearch"
        case .notifications: "appHomeNotifications"
        case .media: "appHomeFiles"
        case .admin: "appHomeAdmin"
        }
    }

    var systemImage: String {
        switch self {
        case .tasks: "checklist"
        case .search: "magnifyingglass"
        case .notifications: "bell"
        case .media: "photo.on.rectangle"
        case .admin: "shield"
        }
    }

    /// Command-key shortcut of the menu command (the same keys the iOS home list uses).
    var shortcut: KeyEquivalent {
        switch self {
        case .tasks: "1"
        case .search: "f"
        case .notifications: "2"
        case .media: "3"
        case .admin: "4"
        }
    }

    /// The `AppFeature` id the server must enable for this section to show.
    var feature: String {
        switch self {
        case .tasks: AppFeature.tasks
        case .search: AppFeature.search
        case .notifications: AppFeature.notifications
        case .media: AppFeature.media
        case .admin: AppFeature.admin
        }
    }
}

/// What the key window can navigate to right now, published with `focusedSceneValue` so the menu bar (`AppCommands`)
/// acts on that window. `entries` is empty while signed out, which disables the commands.
struct SidebarNavigation {
    let entries: [SidebarEntry]
    let open: (SidebarEntry) -> Void
}

private struct SidebarNavigationKey: FocusedValueKey {
    typealias Value = SidebarNavigation
}

extension FocusedValues {
    var sidebarNavigation: SidebarNavigation? {
        get { self[SidebarNavigationKey.self] }
        set { self[SidebarNavigationKey.self] = newValue }
    }
}
