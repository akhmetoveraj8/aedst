import SwiftUI

// iOS, macOS and visionOS only: tvOS and watchOS are scaffolded package platforms without app targets.
#if os(iOS) || os(macOS) || os(visionOS)

/// Mirrors shadcn/ui `ButtonGroup`'s `orientation` axis (`ui-kit.yaml`: horizontal, vertical).
public enum AedstButtonGroupOrientation: Sendable, CaseIterable {
    case horizontal
    case vertical
}

/// Related buttons laid out as one unit, matching shadcn/ui `ButtonGroup`. Put `AedstButton`s (usually
/// `variant: .outline`), `AedstButtonGroupText` and `AedstSeparator` inside.
///
/// Apple adaptation: the buttons keep their own rounded shape and sit a hairline apart instead of sharing
/// borders, because SwiftUI cannot restyle the corners of arbitrary child views. Horizontal buttons that keep
/// `fillsWidth: true` share the width equally.
public struct AedstButtonGroup<Content: View>: View {
    private let label: String?
    private let orientation: AedstButtonGroupOrientation
    private let content: Content

    /// - Parameter label: Accessibility label of the group ("Pagination", "Text formatting").
    public init(
        _ label: String? = nil,
        orientation: AedstButtonGroupOrientation = .horizontal,
        @ViewBuilder content: () -> Content
    ) {
        self.label = label
        self.orientation = orientation
        self.content = content()
    }

    private var layout: AnyLayout {
        switch orientation {
        case .horizontal: AnyLayout(HStackLayout(spacing: AedstSpacing.xxs))
        case .vertical: AnyLayout(VStackLayout(alignment: .leading, spacing: AedstSpacing.xxs))
        }
    }

    public var body: some View {
        let group = layout {
            content
        }
        .accessibilityElement(children: .contain)

        if let label {
            group.accessibilityLabel(Text(label))
        } else {
            group
        }
    }
}

/// Non-interactive text cell of an `AedstButtonGroup` (a unit, a prefix), matching `ButtonGroupText`.
public struct AedstButtonGroupText: View {
    private let text: String

    public init(_ text: String) {
        self.text = text
    }

    public var body: some View {
        Text(text)
            .font(AedstTypography.body.weight(.medium))
            .foregroundStyle(AedstColor.foreground)
            .padding(.horizontal, AedstSpacing.md)
            .frame(minHeight: AedstHitTarget.minimum)
            .background(AedstColor.muted)
            .clipShape(RoundedRectangle(cornerRadius: AedstRadius.md, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: AedstRadius.md, style: .continuous)
                    .strokeBorder(AedstColor.border, lineWidth: 1)
            }
    }
}

#Preview("AedstButtonGroup") {
    VStack(alignment: .leading, spacing: AedstSpacing.lg) {
        AedstButtonGroup("History") {
            AedstButton("Back", systemImage: "chevron.backward", variant: .outline) {}
            AedstButton("Forward", systemImage: "chevron.forward", variant: .outline) {}
        }
        AedstButtonGroup("Amount") {
            AedstButtonGroupText("USD")
            AedstButton("Copy", variant: .outline, fillsWidth: false) {}
        }
        AedstButtonGroup("Zoom", orientation: .vertical) {
            AedstButton("Zoom in", systemImage: "plus", variant: .outline, size: .icon) {}
            AedstButton("Zoom out", systemImage: "minus", variant: .outline, size: .icon) {}
        }
    }
    .padding()
}

#endif
