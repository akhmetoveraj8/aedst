import SwiftUI

// iOS, macOS and visionOS only: tvOS and watchOS are scaffolded package platforms without app targets.
#if os(iOS) || os(macOS) || os(visionOS)

/// shadcn/ui `Marker` `variant`.
public enum AedstMarkerVariant: Sendable, CaseIterable {
    /// Icon and text on one muted row.
    case `default`
    /// Centred text between two hairlines ("Today", "Earlier"), as a divider in a conversation.
    case separator
    /// A row with a hairline under it, as a section heading.
    case border

    /// Whether hairlines are drawn before and after the content.
    var drawsSideRules: Bool { self == .separator }

    /// Whether a hairline is drawn under the row.
    var drawsBottomRule: Bool { self == .border }
}

/// A small inline status line in a list or a conversation, matching shadcn/ui `Marker` with `MarkerIcon` and
/// `MarkerContent` ("Alex joined", a date divider, an "unread" heading). Read as one static text by VoiceOver;
/// the icon is decorative.
public struct AedstMarker<Content: View>: View {
    private let variant: AedstMarkerVariant
    private let systemImage: String?
    private let content: Content

    /// - Parameters:
    ///   - variant: Plain row, centred divider or bottom-ruled heading.
    ///   - systemImage: Optional SF Symbol before the content (`MarkerIcon`).
    ///   - content: The text, may contain links (`MarkerContent`).
    public init(
        variant: AedstMarkerVariant = .default,
        systemImage: String? = nil,
        @ViewBuilder content: () -> Content
    ) {
        self.variant = variant
        self.systemImage = systemImage
        self.content = content()
    }

    public var body: some View {
        HStack(spacing: AedstSpacing.sm) {
            if variant.drawsSideRules { rule }
            if let systemImage {
                Image(systemName: systemImage)
                    .imageScale(.small)
                    .accessibilityHidden(true)
            }
            content
                .multilineTextAlignment(variant == .separator ? .center : .leading)
                .layoutPriority(1)
            if variant.drawsSideRules { rule }
        }
        .font(AedstTypography.caption)
        .foregroundStyle(AedstColor.mutedForeground)
        .frame(maxWidth: .infinity, minHeight: AedstSpacing.lg, alignment: .leading)
        .padding(.bottom, variant.drawsBottomRule ? AedstSpacing.sm : AedstSpacing.none)
        .overlay(alignment: .bottom) {
            if variant.drawsBottomRule { AedstSeparator() }
        }
        .accessibilityElement(children: .combine)
    }

    private var rule: some View {
        AedstSeparator()
            .frame(minWidth: AedstSpacing.none, maxWidth: .infinity)
            .padding(.horizontal, AedstSpacing.xs)
    }
}

extension AedstMarker where Content == Text {
    /// A marker with plain text.
    public init(_ text: String, variant: AedstMarkerVariant = .default, systemImage: String? = nil) {
        self.init(variant: variant, systemImage: systemImage) {
            Text(text)
        }
    }
}

#Preview("AedstMarker") {
    VStack(spacing: AedstSpacing.lg) {
        AedstMarker("Alex joined the conversation", systemImage: "person.badge.plus")
        AedstMarker("Today", variant: .separator)
        AedstMarker("Unread messages", variant: .border)
    }
    .padding()
}

#endif
