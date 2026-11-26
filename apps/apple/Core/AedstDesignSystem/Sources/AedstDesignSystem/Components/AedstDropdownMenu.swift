import SwiftUI

// iOS, macOS and visionOS only: tvOS and watchOS are scaffolded package platforms without app targets.
#if os(iOS) || os(macOS) || os(visionOS)

/// shadcn/ui `DropdownMenuItem` / `ContextMenuItem` `variant`: `destructive` marks a command that deletes or
/// discards something. It becomes the native destructive role, so the system draws it in red, VoiceOver says so,
/// and iOS places it last in its group.
public enum AedstMenuItemVariant: Sendable, CaseIterable {
    case `default`
    case destructive

    var buttonRole: ButtonRole? {
        switch self {
        case .default: nil
        case .destructive: .destructive
        }
    }
}

/// One entry of a menu. The same model feeds `AedstDropdownMenu`, `aedstContextMenu(items:)` and
/// `AedstMenubar`, so a list of commands is declared once and shown in any of them.
///
/// Mapping from shadcn/ui: `DropdownMenuItem` -> `.action`, `DropdownMenuCheckboxItem` and
/// `DropdownMenuRadioItem` -> `.checkbox` (the caller owns the checked state), `DropdownMenuSub` -> `.submenu`,
/// `DropdownMenuGroup` + `DropdownMenuLabel` -> `.section`, `DropdownMenuSeparator` -> `.separator`,
/// `DropdownMenuShortcut` -> the `shortcut` parameter (a real key equivalent, shown by the system on macOS
/// and with a hardware keyboard on iPadOS).
public struct AedstMenuItem {
    enum Content {
        case action(() -> Void)
        case checkbox(isOn: Bool, toggle: () -> Void)
        case submenu([AedstMenuItem])
        case section([AedstMenuItem])
        case separator
    }

    let title: String
    let systemImage: String?
    let shortcut: KeyboardShortcut?
    let variant: AedstMenuItemVariant
    let isDisabled: Bool
    let content: Content

    /// A command.
    public static func action(
        _ title: String,
        systemImage: String? = nil,
        shortcut: KeyboardShortcut? = nil,
        variant: AedstMenuItemVariant = .default,
        isDisabled: Bool = false,
        action: @escaping () -> Void
    ) -> AedstMenuItem {
        AedstMenuItem(
            title: title,
            systemImage: systemImage,
            shortcut: shortcut,
            variant: variant,
            isDisabled: isDisabled,
            content: .action(action)
        )
    }

    /// A command with a check mark. `isOn` is the current state; `toggle` is called when the user picks it.
    /// A radio group is a run of these where exactly one has `isOn == true`.
    public static func checkbox(
        _ title: String,
        isOn: Bool,
        isDisabled: Bool = false,
        toggle: @escaping () -> Void
    ) -> AedstMenuItem {
        AedstMenuItem(
            title: title,
            systemImage: nil,
            shortcut: nil,
            variant: .default,
            isDisabled: isDisabled,
            content: .checkbox(isOn: isOn, toggle: toggle)
        )
    }

    /// A nested menu.
    public static func submenu(_ title: String, systemImage: String? = nil, items: [AedstMenuItem]) -> AedstMenuItem {
        AedstMenuItem(
            title: title,
            systemImage: systemImage,
            shortcut: nil,
            variant: .default,
            isDisabled: false,
            content: .submenu(items)
        )
    }

    /// A group of entries under an optional heading (pass an empty title for a plain group).
    public static func section(_ title: String = "", items: [AedstMenuItem]) -> AedstMenuItem {
        AedstMenuItem(
            title: title,
            systemImage: nil,
            shortcut: nil,
            variant: .default,
            isDisabled: false,
            content: .section(items)
        )
    }

    /// A dividing line.
    public static var separator: AedstMenuItem {
        AedstMenuItem(title: "", systemImage: nil, shortcut: nil, variant: .default, isDisabled: false, content: .separator)
    }
}

/// Renders menu entries as native menu content (`Button`, `Toggle`, `Menu`, `Section`, `Divider`), so the system
/// draws, positions and reads them: VoiceOver, keyboard navigation and right-to-left come for free.
/// Entries are static per menu, so their position is their identity.
struct AedstMenuItems: View {
    let items: [AedstMenuItem]

    var body: some View {
        ForEach(Array(items.enumerated()), id: \.offset) { _, item in
            AedstMenuItemView(item: item)
        }
    }
}

/// One native menu entry.
struct AedstMenuItemView: View {
    let item: AedstMenuItem

    var body: some View {
        switch item.content {
        case .separator:
            Divider()
        case .action(let action):
            Button(role: item.variant.buttonRole, action: action) {
                label
            }
            .keyboardShortcut(item.shortcut)
            .disabled(item.isDisabled)
        case .checkbox(let isOn, let toggle):
            Toggle(isOn: Binding(get: { isOn }, set: { _ in toggle() })) {
                label
            }
            .disabled(item.isDisabled)
        case .submenu(let children):
            Menu {
                AedstMenuItems(items: children)
            } label: {
                label
            }
        case .section(let children):
            if item.title.isEmpty {
                Section {
                    AedstMenuItems(items: children)
                }
            } else {
                Section(item.title) {
                    AedstMenuItems(items: children)
                }
            }
        }
    }

    @ViewBuilder private var label: some View {
        if let systemImage = item.systemImage {
            Label(item.title, systemImage: systemImage)
        } else {
            Text(item.title)
        }
    }
}

/// The default trigger of `AedstDropdownMenu`: an outline chip with a title and a disclosure chevron.
public struct AedstMenuTriggerLabel: View {
    private let title: String
    private let systemImage: String?

    /// - Parameters:
    ///   - title: Already localized title.
    ///   - systemImage: Optional SF Symbol before the title.
    public init(_ title: String, systemImage: String? = nil) {
        self.title = title
        self.systemImage = systemImage
    }

    public var body: some View {
        HStack(spacing: AedstSpacing.xs) {
            if let systemImage {
                Image(systemName: systemImage)
            }
            Text(title)
            Image(systemName: "chevron.down")
                .font(AedstTypography.caption)
                .foregroundStyle(AedstColor.mutedForeground)
                .accessibilityHidden(true)
        }
        .font(AedstTypography.body.weight(.medium))
        .foregroundStyle(AedstColor.foreground)
        .padding(.horizontal, AedstSpacing.md)
        .frame(minHeight: 36)
        .background(AedstColor.background)
        .clipShape(RoundedRectangle(cornerRadius: AedstRadius.md, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: AedstRadius.md, style: .continuous)
                .strokeBorder(AedstColor.border, lineWidth: 1)
        }
    }
}

/// Menu opened from a trigger, matching shadcn/ui `DropdownMenu`. It is the native `Menu`: a pull-down on
/// iOS and iPadOS, a pop-up menu on macOS, with the system's own placement, dismissal and accessibility.
public struct AedstDropdownMenu<Trigger: View>: View {
    private let items: [AedstMenuItem]
    private let trigger: Trigger

    /// - Parameters:
    ///   - items: Menu entries, top to bottom.
    ///   - trigger: The view the user taps. Give an icon-only trigger an `accessibilityLabel`.
    public init(items: [AedstMenuItem], @ViewBuilder trigger: () -> Trigger) {
        self.items = items
        self.trigger = trigger()
    }

    public var body: some View {
        Menu {
            AedstMenuItems(items: items)
        } label: {
            trigger.aedstHitTarget()
        }
        #if os(macOS)
        // The trigger draws its own chrome; drop the system button bezel and its extra indicator.
        .menuStyle(.borderlessButton)
        .menuIndicator(.hidden)
        .fixedSize()
        #endif
    }
}

extension AedstDropdownMenu where Trigger == AedstMenuTriggerLabel {
    /// A menu behind the kit's default outline trigger.
    public init(_ title: String, systemImage: String? = nil, items: [AedstMenuItem]) {
        self.init(items: items) {
            AedstMenuTriggerLabel(title, systemImage: systemImage)
        }
    }
}

#Preview("AedstDropdownMenu") {
    @Previewable @State var showsStatusBar = true
    AedstDropdownMenu(
        "Options",
        items: [
            .section("My account", items: [
                .action("Profile", systemImage: "person", shortcut: KeyboardShortcut("p", modifiers: [.command, .shift])) {},
                .action("Settings", systemImage: "gearshape") {},
            ]),
            .checkbox("Status bar", isOn: showsStatusBar) { showsStatusBar.toggle() },
            .submenu("Invite", items: [.action("Email") {}, .action("Message") {}]),
            .separator,
            .action("Delete", systemImage: "trash", variant: .destructive) {},
        ]
    )
    .padding()
}

#endif
