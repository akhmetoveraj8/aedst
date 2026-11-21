import SwiftUI

/// Mirrors the web `typography` component's variants (`ui-kit.yaml`: h1, h2, h3, h4, p, blockquote, list,
/// inline-code, lead, large, small, muted).
public enum AedstTextVariant: Sendable, CaseIterable {
    case h1
    case h2
    case h3
    case h4
    case p
    case blockquote
    case list
    case inlineCode
    case lead
    case large
    case small
    case muted

    /// Dynamic Type text style behind the variant: no fixed point sizes.
    var font: Font {
        switch self {
        case .h1: AedstTypography.largeTitle
        case .h2: AedstTypography.title
        case .h3: Font.system(.title3, design: .default).weight(.semibold)
        case .h4: AedstTypography.headline
        case .p, .list, .blockquote: AedstTypography.body
        case .inlineCode: Font.system(.callout, design: .monospaced).weight(.medium)
        case .lead: Font.system(.title3, design: .default).weight(.regular)
        case .large: Font.system(.body, design: .default).weight(.semibold)
        case .small: Font.system(.footnote, design: .default).weight(.medium)
        case .muted: Font.system(.subheadline, design: .default).weight(.regular)
        }
    }

    var color: Color {
        switch self {
        case .lead, .muted: AedstColor.mutedForeground
        case .h1, .h2, .h3, .h4, .p, .blockquote, .list, .inlineCode, .large, .small: AedstColor.foreground
        }
    }

    /// Heading level announced by assistive technology; `nil` for body variants.
    var headingLevel: AccessibilityHeadingLevel? {
        switch self {
        case .h1: .h1
        case .h2: .h2
        case .h3: .h3
        case .h4: .h4
        case .p, .blockquote, .list, .inlineCode, .lead, .large, .small, .muted: nil
        }
    }
}

/// The kit's `typography` component: one piece of text in one of the manifest's text variants. The type is called
/// `AedstText` because `AedstTypography` is already the font token scale this component is built on.
///
/// `list` takes several strings (`AedstText(list:)`) and renders one bulleted row per item.
public struct AedstText: View {
    private let items: [String]
    private let variant: AedstTextVariant

    /// - Parameters:
    ///   - text: Already localized text.
    ///   - variant: Text variant; `.list` shows `text` as a single bullet.
    public init(_ text: String, variant: AedstTextVariant = .p) {
        self.items = [text]
        self.variant = variant
    }

    /// A bulleted list (`variant: .list`), one row per item.
    public init(list items: [String]) {
        self.items = items
        self.variant = .list
    }

    public var body: some View {
        switch variant {
        case .blockquote:
            HStack(alignment: .top, spacing: AedstSpacing.md) {
                Rectangle()
                    .fill(AedstColor.border)
                    .frame(width: AedstSpacing.xxs)
                    .accessibilityHidden(true)
                styled(items.first ?? "").italic()
            }
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityElement(children: .combine)
        case .list:
            VStack(alignment: .leading, spacing: AedstSpacing.xs) {
                ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                    HStack(alignment: .firstTextBaseline, spacing: AedstSpacing.sm) {
                        Text(verbatim: "\u{2022}")
                            .font(variant.font)
                            .foregroundStyle(AedstColor.mutedForeground)
                            .accessibilityHidden(true)
                        styled(item)
                    }
                    .accessibilityElement(children: .combine)
                }
            }
        case .inlineCode:
            styled(items.first ?? "")
                .padding(.horizontal, AedstSpacing.xs)
                .padding(.vertical, AedstSpacing.xxs)
                .background(AedstColor.muted)
                .clipShape(RoundedRectangle(cornerRadius: AedstRadius.xs, style: .continuous))
        case .h1, .h2, .h3, .h4:
            styled(items.first ?? "")
                .accessibilityAddTraits(.isHeader)
                .accessibilityHeading(variant.headingLevel ?? .unspecified)
        case .p, .lead, .large, .small, .muted:
            styled(items.first ?? "")
        }
    }

    private func styled(_ text: String) -> Text {
        Text(text)
            .font(variant.font)
            .foregroundStyle(variant.color)
    }
}

#Preview("AedstText") {
    ScrollView {
        VStack(alignment: .leading, spacing: AedstSpacing.sm) {
            AedstText("Heading 1", variant: .h1)
            AedstText("Heading 2", variant: .h2)
            AedstText("Heading 3", variant: .h3)
            AedstText("Heading 4", variant: .h4)
            AedstText("A lead paragraph introduces the page.", variant: .lead)
            AedstText("Body text explains things at reading size.")
            AedstText("Quoted text stands apart from the body.", variant: .blockquote)
            AedstText(list: ["First item", "Second item", "Third item"])
            AedstText("task check", variant: .inlineCode)
            AedstText("Large text", variant: .large)
            AedstText("Small text", variant: .small)
            AedstText("Muted text", variant: .muted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
    }
}
