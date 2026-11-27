// Renders each kit component in the matrix right-to-left / left-to-right x default / accessibility-5 text size.
// The component exists on iOS, macOS and visionOS only (see the `#if` in every component file).
//
// UNVERIFIED: written without a Swift toolchain and never run. `ImageRenderer` proves the view tree lays out and
// draws at every combination without a crash or an empty result; the pixel layout itself is covered by the
// recorded snapshots in `Snapshots/` (iphone-rtl-ar, iphone-a11y-xxxl).
#if os(iOS) || os(macOS) || os(visionOS)
import Foundation
import SwiftUI
import Testing
@testable import AedstDesignSystem

/// One named component sample.
@MainActor
private struct Sample {
    let name: String
    let view: AnyView

    init(_ name: String, _ view: some View) {
        self.name = name
        self.view = AnyView(view)
    }
}

@MainActor
private func renders(_ sample: Sample, direction: LayoutDirection, size: DynamicTypeSize) -> Bool {
    let content = sample.view
        .environment(\.layoutDirection, direction)
        .environment(\.dynamicTypeSize, size)
        .frame(width: 320)
        .fixedSize(horizontal: false, vertical: true)
    let renderer = ImageRenderer(content: content)
    renderer.scale = 1
    return renderer.cgImage != nil
}

@MainActor
private func samples() -> [Sample] {
    let url = URL(string: "https://www.example.com/docs") ?? URL(filePath: "/")
    var all: [Sample] = []
    for variant in AedstButtonVariant.allCases {
        all.append(Sample("Button \(variant)", AedstButton("Continue", variant: variant) {}))
    }
    for size in AedstButtonSize.allCases {
        all.append(Sample("Button size \(size)", AedstButton("Add", systemImage: "plus", size: size, fillsWidth: false) {}))
    }
    all.append(Sample("Button loading", AedstButton("Save", isLoading: true) {}))
    all.append(Sample("Button disabled", AedstButton("Save", isDisabled: true) {}))
    all.append(Sample("IconButton", AedstIconButton(systemImage: "plus", accessibilityLabel: "Add") {}))
    for size in AedstSwitchSize.allCases {
        all.append(Sample("Switch on \(size)", AedstSwitch("Notifications", isOn: .constant(true), size: size)))
        all.append(Sample("Switch off \(size)", AedstSwitch("Notifications", isOn: .constant(false), size: size)))
    }
    all.append(Sample("Checkbox", AedstCheckbox("Accept", isChecked: .constant(true))))
    all.append(Sample("Toggle", AedstToggle("Bold", systemImage: "bold", isOn: .constant(true))))
    all.append(Sample("Slider", AedstSlider("Volume", value: .constant(0.4), valueText: "40 %")))
    all.append(Sample("Skeleton", AedstSkeleton().frame(width: 200, height: 16)))
    all.append(Sample("TextField", AedstTextField("Name", text: .constant("Ada"), errorMessage: "Required")))
    all.append(Sample("InputOTP", AedstInputOTP(code: .constant("12"), groupSize: 3)))
    all.append(Sample("Avatar", AedstAvatar(name: "Ada Lovelace", size: .lg)))
    all.append(Sample("Sidebar", AedstSidebar {
        AedstSidebarGroup("Workspace") {
            AedstSidebarMenuButton("Inbox", systemImage: "tray", badge: "12", isActive: true) {}
            AedstSidebarMenuButton("Archive", systemImage: "archivebox", size: .sm) {}
        }
    }))
    all.append(Sample("Queue", AedstAiQueue {
        AedstAiQueueSection("2 to do") {
            AedstAiQueueItem("Rename", status: .inProgress, statusLabel: "In progress")
        }
    }))
    all.append(Sample("Sources", AedstAiSources(initiallyExpanded: true) {
        AedstAiSourcesTrigger("Used 1 source")
    } content: {
        AedstAiSourcesContent { AedstAiSource(href: url) }
    }))
    all.append(Sample("Sources unsafe link", AedstAiSource(href: URL(string: "javascript:alert(1)") ?? url)))
    all.append(Sample("Toast", Color.clear.frame(height: 120).aedstToast(
        .constant(AedstToastData(title: "Saved", message: "Your changes are live.", severity: .success))
    )))
    return all
}

@Suite("Components in RTL and at accessibility text size")
@MainActor
struct AedstComponentMatrixTests {
    @Test("every sample renders left-to-right and right-to-left at the default and the largest text size")
    func matrix() {
        for sample in samples() {
            for direction in [LayoutDirection.leftToRight, .rightToLeft] {
                for size in [DynamicTypeSize.large, .accessibility5] {
                    #expect(
                        renders(sample, direction: direction, size: size),
                        "\(sample.name) failed to render (\(direction), \(size))"
                    )
                }
            }
        }
    }

    @Test("the matrix covers every button variant and size and both switch sizes")
    func coverage() {
        let names = Set(samples().map(\.name))
        for variant in AedstButtonVariant.allCases { #expect(names.contains("Button \(variant)")) }
        for size in AedstButtonSize.allCases { #expect(names.contains("Button size \(size)")) }
        for size in AedstSwitchSize.allCases { #expect(names.contains("Switch on \(size)")) }
        #expect(names.count >= 25)
    }
}
#endif
