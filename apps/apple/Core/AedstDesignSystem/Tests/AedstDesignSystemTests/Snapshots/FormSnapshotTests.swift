// Pixel snapshots are platform-specific (fonts, rasterization): iOS Simulator and macOS only;
// other platforms compile this file to nothing. Variants and the helper live in SnapshotSupport.swift;
// see README.md in this folder for recording and the CI command.
//
// UNVERIFIED: written without a Swift toolchain and never run. No reference images exist.
#if os(iOS) || os(macOS)
import AedstDesignSystem
import Foundation
import SnapshotTesting
import SwiftUI
import Testing

/// Forms, toggles and disclosure components in their static states (one image per component x variant).
@MainActor
@Suite(
    "Form snapshots",
    .serialized,
    // Skipped (not failed) while no references are recorded; AEDST_SNAPSHOTS=verify|record|skip overrides.
    .enabled(if: SnapshotMode.shouldRun(suite: "FormSnapshotTests"), "no reference images recorded yet (see Snapshots/README.md)")
)
struct FormSnapshotTests {
    @Test("AedstField and AedstForm")
    func fieldAndForm() {
        assertComponent(height: 620) {
            AedstForm(submitTitle: "Save", isSubmitDisabled: true) {
                AedstField("Marketing emails", description: "At most monthly.", orientation: .horizontal) {
                    AedstSwitch("Marketing emails", isOn: .constant(true)).labelsHidden()
                }
                AedstField("Volume", errorMessage: "Too loud.", isRequired: true) {
                    AedstSlider("Volume", value: .constant(0.4), showsLabel: false)
                }
                AedstField("Security alerts", description: "Always on.", orientation: .responsive) {
                    AedstSwitch("Security alerts", isOn: .constant(true)).labelsHidden()
                }
                AedstTextarea("Note", text: .constant(""), placeholder: "Optional", helperText: "Up to 500 characters.")
            }
        }
    }

    @Test("AedstInputGroup")
    func inputGroup() {
        assertComponent(height: 420) {
            VStack(spacing: AedstSpacing.lg) {
                AedstInputGroup {
                    AedstInputGroupInput("Search", text: .constant(""))
                } addon: {
                    AedstInputGroupText(systemImage: "magnifyingglass")
                }
                AedstInputGroup(align: .inlineEnd) {
                    AedstInputGroupInput("Website", text: .constant("aedst.dev"))
                } addon: {
                    AedstInputGroupButton("Copy", systemImage: "doc.on.doc", size: .iconXs) {}
                }
                AedstInputGroup(align: .blockStart) {
                    AedstInputGroupInput("Amount", text: .constant("100"))
                } addon: {
                    AedstInputGroupText("USD")
                }
                AedstInputGroup(align: .blockEnd, isInvalid: true) {
                    AedstInputGroupInput("Message", text: .constant(""))
                } addon: {
                    AedstInputGroupButton("Send", variant: .default, size: .sm) {}
                }
            }
        }
    }

    @Test("AedstInputOTP, AedstTextarea and AedstSlider")
    func inputs() {
        assertComponent(height: 680) {
            VStack(alignment: .leading, spacing: AedstSpacing.lg) {
                AedstInputOTP(code: .constant("123"), groupSize: 3)
                AedstInputOTP(code: .constant("0000"), length: 4, errorMessage: "The code is not valid.")
                AedstTextarea("Comment", text: .constant("Too short"), errorMessage: "Write at least 20 characters.")
                AedstSlider("Volume", value: .constant(0.4), valueText: "40 %")
                AedstSlider("Disabled", value: .constant(0.5), isDisabled: true)
            }
        }
    }

    @Test("AedstToggle, AedstToggleGroup and AedstButtonGroup")
    func toggles() {
        assertComponent(height: 620) {
            VStack(alignment: .leading, spacing: AedstSpacing.lg) {
                HStack(spacing: AedstSpacing.sm) {
                    AedstToggle("Small", isOn: .constant(true), size: .sm)
                    AedstToggle("Default", isOn: .constant(false), variant: .outline)
                    AedstToggle("Large", isOn: .constant(true), variant: .outline, size: .lg)
                }
                AedstToggle("Bold", systemImage: "bold", isOn: .constant(false), showsTitle: false, isDisabled: true)
                AedstToggleGroup(
                    "Text style",
                    items: [
                        AedstToggleGroupItem("bold", title: "Bold"),
                        AedstToggleGroupItem("italic", title: "Italic"),
                        AedstToggleGroupItem("underline", title: "Underline", isDisabled: true),
                    ],
                    selections: .constant(["bold"]),
                    variant: .outline
                )
                AedstButtonGroup("History") {
                    AedstButton("Back", variant: .outline) {}
                    AedstButton("Forward", variant: .outline) {}
                }
                AedstButtonGroup("Zoom", orientation: .vertical) {
                    AedstButton("Zoom in", systemImage: "plus", variant: .outline, size: .icon) {}
                    AedstButton("Zoom out", systemImage: "minus", variant: .outline, size: .icon) {}
                }
            }
        }
    }

    @Test("AedstTabs")
    func tabs() {
        let items = [
            AedstTabItem("account", title: "Account"),
            AedstTabItem("password", title: "Password"),
            AedstTabItem("billing", title: "Billing", isDisabled: true),
        ]
        assertComponent(height: 320) {
            VStack(alignment: .leading, spacing: AedstSpacing.xxl) {
                AedstTabs(items: items, selection: .constant("account")) { _ in
                    Text("Account panel")
                }
                AedstTabs(items: items, selection: .constant("password"), variant: .line) { _ in
                    Text("Password panel")
                }
            }
        }
    }

    @Test("AedstAccordion and AedstCollapsible")
    func disclosure() {
        assertComponent(height: 520) {
            VStack(alignment: .leading, spacing: AedstSpacing.lg) {
                AedstAccordion(
                    items: [
                        AedstAccordionItem(id: "shipping", title: "Is shipping free?"),
                        AedstAccordionItem(id: "returns", title: "How do returns work?"),
                        AedstAccordionItem(id: "gift", title: "Gift cards", isDisabled: true),
                    ],
                    expanded: .constant(["shipping"])
                ) { _ in
                    Text("Yes, for every order.")
                }
                AedstCollapsible("Open", initiallyExpanded: true) {
                    Text("Visible content")
                }
                AedstCollapsible("Closed") {
                    Text("Hidden content")
                }
            }
        }
    }

    @Test("AedstTrace")
    func trace() {
        assertComponent(height: 420) {
            AedstTrace(steps: [
                AedstTraceStep(id: "plan", title: "Plan", status: .success, duration: "0.4 s"),
                AedstTraceStep(
                    id: "search",
                    title: "Search the codebase",
                    // `error` (not `running`): a spinner would make the image depend on the animation phase.
                    status: .error,
                    detail: "Permission denied",
                    children: [
                        AedstTraceStep(id: "grep", title: "grep", status: .success, duration: "1.2 s"),
                        AedstTraceStep(id: "read", title: "Read files", status: .skipped),
                    ]
                ),
                AedstTraceStep(id: "edit", title: "Edit", status: .pending),
            ])
        }
    }
}
#endif
