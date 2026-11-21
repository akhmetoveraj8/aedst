// Pixel snapshots are platform-specific (fonts, rasterization): iOS Simulator and macOS only;
// other platforms compile this file to nothing. Variants and the helper live in SnapshotSupport.swift;
// see README.md in this folder for recording and the CI command.
#if os(iOS) || os(macOS)
import AedstDesignSystem
import Foundation
import SnapshotTesting
import SwiftUI
import Testing

/// One image per component group x variant (iPhone, iPad, macOS; light/dark; large Dynamic Type; RTL).
@MainActor
@Suite(
    "Component snapshots",
    .serialized,
    // Skipped (not failed) while no references are recorded; AEDST_SNAPSHOTS=verify|record|skip overrides.
    .enabled(if: SnapshotMode.shouldRun, "no reference images recorded yet (see Snapshots/README.md)")
)
struct ComponentSnapshotTests {
    // MARK: Components

    @Test("AedstButton")
    func button() {
        assertComponent(height: 720) {
            VStack(alignment: .leading, spacing: AedstSpacing.sm) {
                AedstButton("Default") {}
                AedstButton("Secondary", variant: .secondary) {}
                AedstButton("Destructive", variant: .destructive) {}
                AedstButton("Outline", variant: .outline) {}
                AedstButton("Ghost", variant: .ghost) {}
                AedstButton("Link", variant: .link) {}
                AedstButton("With icon", systemImage: "plus") {}
                AedstButton("Loading", isLoading: true) {}
                AedstButton("Disabled", isDisabled: true) {}
                AedstButton("Extra small", size: .xs) {}
                AedstButton("Small", size: .sm) {}
                AedstButton("Large", size: .lg) {}
                HStack(spacing: AedstSpacing.sm) {
                    AedstButton("Add", systemImage: "plus", size: .iconXs) {}
                    AedstButton("Add", systemImage: "plus", size: .iconSm) {}
                    AedstButton("Add", systemImage: "plus", size: .icon) {}
                    AedstButton("Add", systemImage: "plus", size: .iconLg) {}
                }
            }
        }
    }

    @Test("AedstBadge")
    func badge() {
        assertComponent(height: 420) {
            VStack(alignment: .leading, spacing: AedstSpacing.sm) {
                AedstBadge("Default")
                AedstBadge("Secondary", variant: .secondary)
                AedstBadge("Destructive", variant: .destructive)
                AedstBadge("Success", variant: .success)
                AedstBadge("Warning", variant: .warning)
                AedstBadge("Info", variant: .info)
                AedstBadge("Outline", variant: .outline)
                AedstBadge("Ghost", variant: .ghost)
                AedstBadge("Link", variant: .link)
            }
        }
    }

    @Test("AedstAlert")
    func alert() {
        assertComponent(height: 420) {
            VStack(spacing: AedstSpacing.sm) {
                AedstAlert("Heads up", message: "Informational message.")
                AedstAlert("Failed", message: "Something went wrong.", variant: .destructive)
                AedstAlert("Saved", systemImage: "checkmark.circle.fill")
                AedstAlert("Title only")
            }
        }
    }

    @Test("AedstTextField")
    func textField() {
        assertComponent(height: 760) {
            VStack(alignment: .leading, spacing: AedstSpacing.lg) {
                AedstTextField("Empty", text: .constant(""), placeholder: "name@example.com")
                AedstTextField("Filled", text: .constant("ada@example.com"))
                AedstTextField("With helper", text: .constant(""), helperText: "We never share your email.")
                AedstTextField("With error", text: .constant("nope"), errorMessage: "Enter a valid email.")
                AedstTextField("Secure", text: .constant("secret"), isSecure: true)
                AedstTextField("Disabled", text: .constant("read only"), isDisabled: true)
            }
        }
    }

    @Test("AedstCard")
    func card() {
        assertComponent(height: 420) {
            AedstCard {
                AedstCardHeader("Project Apollo", subtitle: "Updated 2 hours ago")
                Text("Card content that is long enough to wrap onto a second line at the default text size.")
                AedstCardFooter {
                    AedstButton("Open", size: .sm) {}
                }
            }
        }
    }

    @Test("AedstSkeleton")
    func skeleton() {
        // Widths stay <= 200pt on purpose: the shimmer gradient is offset by +-200pt, so it is
        // fully clipped out of view whichever animation phase the snapshot catches.
        assertComponent(height: 260) {
            VStack(alignment: .leading, spacing: AedstSpacing.sm) {
                AedstSkeleton(cornerRadius: AedstRadius.full).frame(width: 48, height: 48)
                AedstSkeleton().frame(width: 200, height: 16)
                AedstSkeleton().frame(width: 160, height: 16)
            }
        }
    }
    @Test("AedstText")
    func text() {
        assertComponent(height: 620) {
            VStack(alignment: .leading, spacing: AedstSpacing.sm) {
                AedstText("Heading 1", variant: .h1)
                AedstText("Heading 2", variant: .h2)
                AedstText("Heading 3", variant: .h3)
                AedstText("Heading 4", variant: .h4)
                AedstText("A lead paragraph.", variant: .lead)
                AedstText("Body text at reading size.")
                AedstText("A quotation.", variant: .blockquote)
                AedstText(list: ["First", "Second"])
                AedstText("task check", variant: .inlineCode)
                AedstText("Large", variant: .large)
                AedstText("Small", variant: .small)
                AedstText("Muted", variant: .muted)
            }
        }
    }

    @Test("AedstItem, AedstEmpty")
    func itemAndEmpty() {
        assertComponent(height: 720) {
            VStack(spacing: AedstSpacing.sm) {
                AedstItem("Default", description: "Title and description.")
                AedstItem("Outline", variant: .outline) {
                    AedstItemMedia(variant: .icon) { Image(systemName: "shield") }
                } actions: {
                    AedstBadge("New")
                }
                AedstItem("Muted, small", variant: .muted, size: .sm) {
                    AedstItemMedia(variant: .image, size: .sm) { AedstColor.chart2 }
                } actions: {
                    EmptyView()
                }
                AedstItem("Extra small", description: "Dense.", size: .xs)
                AedstEmpty("No tasks yet", description: "Create the first task.", systemImage: "tray")
                AedstEmpty("Nothing found", systemImage: "magnifyingglass", variant: .icon)
            }
        }
    }

    @Test("AedstAvatar, AedstKbd")
    func avatarAndKbd() {
        // AedstSpinner is left out on purpose: an animating indicator has no stable frame.
        assertComponent(height: 220) {
            VStack(alignment: .leading, spacing: AedstSpacing.sm) {
                HStack(spacing: AedstSpacing.sm) {
                    AedstAvatar(name: "Ada Lovelace", size: .sm)
                    AedstAvatar(name: "Ada Lovelace")
                    AedstAvatar(name: "Ada Lovelace", size: .lg)
                }
                AedstKbd("Esc")
                AedstKbd(keys: ["Ctrl", "K"])
            }
        }
    }
}
#endif
