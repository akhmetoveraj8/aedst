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
        assertComponent(height: 560) {
            VStack(alignment: .leading, spacing: AedstSpacing.sm) {
                AedstButton("Primary") {}
                AedstButton("Secondary", variant: .secondary) {}
                AedstButton("Destructive", variant: .destructive) {}
                AedstButton("Outline", variant: .outline) {}
                AedstButton("Ghost", variant: .ghost) {}
                AedstButton("Link", variant: .link) {}
                AedstButton("With icon", systemImage: "plus") {}
                AedstButton("Loading", isLoading: true) {}
                AedstButton("Disabled", isDisabled: true) {}
                AedstButton("Small", size: .sm) {}
                AedstButton("Large", size: .lg) {}
            }
        }
    }

    @Test("AedstBadge")
    func badge() {
        assertComponent(height: 220) {
            VStack(alignment: .leading, spacing: AedstSpacing.sm) {
                AedstBadge("Default")
                AedstBadge("Secondary", variant: .secondary)
                AedstBadge("Destructive", variant: .destructive)
                AedstBadge("Outline", variant: .outline)
            }
        }
    }

    @Test("AedstAlert")
    func alert() {
        assertComponent(height: 560) {
            VStack(spacing: AedstSpacing.sm) {
                AedstAlert("Heads up", message: "Informational message.", severity: .info)
                AedstAlert("Saved", message: "Your changes were saved.", severity: .success)
                AedstAlert("Careful", message: "This action has side effects.", severity: .warning)
                AedstAlert("Failed", message: "Something went wrong.", severity: .destructive)
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
}
#endif
