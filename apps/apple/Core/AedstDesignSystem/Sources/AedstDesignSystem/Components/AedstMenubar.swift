import SwiftUI

// iOS, macOS and visionOS only: tvOS and watchOS are scaffolded package platforms without app targets.
#if os(iOS) || os(macOS) || os(visionOS)

/// One top-level menu of an `AedstMenubar` (shadcn/ui `MenubarMenu` + `MenubarTrigger` + `MenubarContent`).
public struct AedstMenubarMenu: Identifiable {
    public let id: String
    let title: String
    let items: [AedstMenuItem]

    /// - Parameters:
    ///   - title: Already localized title shown in the bar.
    ///   - id: Stable identity; defaults to the title.
    ///   - items: Entries of the menu.
    public init(_ title: String, id: String? = nil, items: [AedstMenuItem]) {
        self.id = id ?? title
        self.title = title
        self.items = items
    }
}

/// In-window row of menus matching shadcn/ui `Menubar`, for a document or an editor pane.
///
/// Each title opens a native `Menu`, so placement, dismissal, keyboard navigation and VoiceOver are the
/// system's. On macOS the application's real menu bar is declared with SwiftUI `commands` in the app target;
/// use this component only for menus that belong to one pane inside the window, never as a replacement for it.
public struct AedstMenubar: View {
    private let menus: [AedstMenubarMenu]

    /// - Parameter menus: Menus in reading order (the row mirrors itself in right-to-left layouts).
    public init(menus: [AedstMenubarMenu]) {
        self.menus = menus
    }

    public var body: some View {
        HStack(spacing: AedstSpacing.xxs) {
            ForEach(menus) { menu in
                Menu {
                    AedstMenuItems(items: menu.items)
                } label: {
                    Text(menu.title)
                        .font(AedstTypography.body.weight(.medium))
                        .foregroundStyle(AedstColor.foreground)
                        .padding(.horizontal, AedstSpacing.sm)
                        .padding(.vertical, AedstSpacing.xs)
                        .aedstHitTarget()
                }
                #if os(macOS)
                .menuStyle(.borderlessButton)
                .menuIndicator(.hidden)
                .fixedSize()
                #endif
            }
        }
        .padding(AedstSpacing.xxs)
        .background(AedstColor.background)
        .clipShape(RoundedRectangle(cornerRadius: AedstRadius.md, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: AedstRadius.md, style: .continuous)
                .strokeBorder(AedstColor.border, lineWidth: 1)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(AedstStrings.menu))
    }
}

#Preview("AedstMenubar") {
    @Previewable @State var showsRuler = false
    AedstMenubar(menus: [
        AedstMenubarMenu("File", items: [
            .action("New", shortcut: KeyboardShortcut("n", modifiers: .command)) {},
            .action("Open", shortcut: KeyboardShortcut("o", modifiers: .command)) {},
            .separator,
            .submenu("Share", items: [.action("Email") {}, .action("Message") {}]),
        ]),
        AedstMenubarMenu("Edit", items: [
            .action("Undo", shortcut: KeyboardShortcut("z", modifiers: .command)) {},
            .action("Redo", shortcut: KeyboardShortcut("z", modifiers: [.command, .shift])) {},
        ]),
        AedstMenubarMenu("View", items: [
            .checkbox("Ruler", isOn: showsRuler) { showsRuler.toggle() },
        ]),
    ])
    .padding()
}

#endif
