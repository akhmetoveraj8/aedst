// Pixel snapshots are platform-specific (fonts, rasterization): iOS Simulator and macOS only;
// other platforms compile this file to nothing. Variants and the helper live in SnapshotSupport.swift;
// see README.md in this folder for recording and the CI command.
//
// Only the parts that render inline are covered: the presented surfaces (dialog, drawer, popover, hover card,
// tooltip, open menus) live in system windows that an off-screen snapshot does not capture.
// UNVERIFIED: written without a Swift toolchain and never run. No reference images exist.
#if os(iOS) || os(macOS)
import AedstDesignSystem
import Foundation
import SnapshotTesting
import SwiftUI
import Testing

/// One image per overlay/menu component x variant (iPhone, iPad, macOS; light/dark; large Dynamic Type; RTL).
@MainActor
@Suite(
    "Overlay snapshots",
    .serialized,
    // Skipped (not failed) while no references are recorded; AEDST_SNAPSHOTS=verify|record|skip overrides.
    .enabled(if: SnapshotMode.shouldRun(suite: "OverlaySnapshotTests"), "no reference images recorded yet (see Snapshots/README.md)")
)
struct OverlaySnapshotTests {
    private var options: [AedstSelectOption] {
        [
            AedstSelectOption(id: "apple", title: "Apple"),
            AedstSelectOption(id: "banana", title: "Banana"),
            AedstSelectOption(id: "grape", title: "Grape", isDisabled: true),
        ]
    }

    private var menuItems: [AedstMenuItem] {
        [
            .action("Profile", systemImage: "person") {},
            .separator,
            .action("Delete", systemImage: "trash", role: .destructive) {},
        ]
    }

    @Test("AedstSelect, AedstCombobox and AedstNativeSelect (closed)")
    func selects() {
        let options = self.options
        assertComponent(height: 620) {
            VStack(alignment: .leading, spacing: AedstSpacing.lg) {
                AedstSelect("Fruit", options: options, selection: .constant("apple"))
                AedstSelect("Empty", options: options, selection: .constant(nil))
                AedstSelect("Invalid", options: options, selection: .constant(nil), errorMessage: "Pick one.")
                AedstSelect("Disabled", options: options, selection: .constant("banana"), isDisabled: true)
                AedstCombobox("Searchable", options: options, selection: .constant("banana"))
                AedstNativeSelect("Native", options: options, selection: .constant("apple"))
            }
        }
    }

    @Test("AedstCommand")
    func command() {
        assertComponent(height: 420) {
            AedstCommand(groups: [
                AedstCommandGroup("Suggestions", items: [
                    AedstCommandItem("Calendar", systemImage: "calendar") {},
                    AedstCommandItem("Search tasks", systemImage: "magnifyingglass") {},
                ]),
                AedstCommandGroup("Settings", items: [
                    AedstCommandItem("Profile", systemImage: "person", shortcut: "⌘P") {},
                    AedstCommandItem("Billing", systemImage: "creditcard", shortcut: "⌘B", isDisabled: true) {},
                ]),
            ])
        }
    }

    @Test("AedstDropdownMenu trigger, AedstMenubar and AedstNavigationMenu (closed)")
    func menus() {
        let menuItems = self.menuItems
        assertComponent(height: 320) {
            VStack(alignment: .leading, spacing: AedstSpacing.lg) {
                AedstDropdownMenu("Options", systemImage: "ellipsis.circle", items: menuItems)
                AedstMenubar(menus: [
                    AedstMenubarMenu("File", items: menuItems),
                    AedstMenubarMenu("Edit", items: menuItems),
                    AedstMenubarMenu("View", items: menuItems),
                ])
                AedstNavigationMenu(items: [
                    .panel("Getting started", links: [AedstNavigationMenuLink("Introduction") {}]),
                    .link("Documentation", isCurrent: true) {},
                    .link("Changelog") {},
                ])
            }
        }
    }

    @Test("Triggers of AedstPopover, AedstHoverCard, AedstTooltip, AedstContextMenu, AedstDialog and AedstDrawer")
    func triggers() {
        let menuItems = self.menuItems
        assertComponent(height: 420) {
            VStack(alignment: .leading, spacing: AedstSpacing.lg) {
                AedstButton("Popover", variant: .outline, fillsWidth: false) {}
                    .aedstPopover(isPresented: .constant(false)) { AedstPopoverHeader("Title", description: "Text") }
                AedstHoverCard {
                    Text("@aedst").underline()
                } card: {
                    Text("Card")
                }
                AedstIconButton(systemImage: "plus", accessibilityLabel: "Add", variant: .outline) {}
                    .aedstTooltip("Add to library")
                AedstBadge("Context menu", variant: .outline)
                    .aedstContextMenu(items: menuItems)
                AedstButton("Dialog", variant: .secondary, fillsWidth: false) {}
                    .aedstDialog(isPresented: .constant(false), title: "Title") { Text("Body") }
                AedstButton("Drawer", variant: .secondary, fillsWidth: false) {}
                    .aedstDrawer(isPresented: .constant(false), title: "Title") {
                        Text("Body")
                    } footer: {
                        AedstButton("Close") {}
                    }
            }
        }
    }
}
#endif
