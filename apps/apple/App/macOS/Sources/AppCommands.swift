import AedstAppCore
import SwiftUI

/// Menu bar commands of the Mac app: the standard sidebar toggle plus one command per sidebar section in the View
/// menu (Command-1 ... Command-4, Command-F for search). They act on the key window through `SidebarNavigation`
/// and are disabled when that window cannot open the section (signed out, not an admin, feature switched off).
struct AppCommands: Commands {
    @FocusedValue(\.sidebarNavigation) private var navigation

    var body: some Commands {
        SidebarCommands()
        CommandGroup(after: .sidebar) {
            Divider()
            ForEach(SidebarEntry.allCases, id: \.self) { entry in
                Button(String(localized: entry.titleKey, bundle: AppStrings.bundle)) {
                    navigation?.open(entry)
                }
                .keyboardShortcut(entry.shortcut, modifiers: .command)
                .disabled(navigation?.entries.contains(entry) != true)
            }
        }
    }
}
