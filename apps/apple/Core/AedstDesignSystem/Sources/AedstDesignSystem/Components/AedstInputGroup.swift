import SwiftUI

// iOS, macOS and visionOS only: tvOS and watchOS are scaffolded package platforms without app targets.
#if os(iOS) || os(macOS) || os(visionOS)

/// Mirrors shadcn/ui `InputGroupAddon`'s `align` axis (`ui-kit.yaml`: inline-start, inline-end, block-start,
/// block-end). "Inline" follows the reading direction, so `inlineStart` is the leading edge.
public enum AedstInputGroupAlign: Sendable, CaseIterable {
    /// Before the input, on the leading edge.
    case inlineStart
    /// After the input, on the trailing edge.
    case inlineEnd
    /// Above the input.
    case blockStart
    /// Below the input.
    case blockEnd
}

/// Mirrors shadcn/ui `InputGroupButton`'s `size` prop (`ui-kit.yaml`: xs, sm, icon-xs, icon-sm).
public enum AedstInputGroupSize: Sendable, CaseIterable {
    case xs
    case sm
    case iconXs
    case iconSm

    var buttonSize: AedstButtonSize {
        switch self {
        case .xs: .xs
        case .sm: .sm
        case .iconXs: .iconXs
        case .iconSm: .iconSm
        }
    }
}

/// An input and its addon (icon, text, button) inside one bordered box, matching shadcn/ui `InputGroup`.
///
/// One addon slot with an alignment covers the kit's cases; for a second addon put an `HStack` of
/// `AedstInputGroupInput` and the extra part into the `input` slot.
public struct AedstInputGroup<Input: View, Addon: View>: View {
    private let align: AedstInputGroupAlign
    private let isInvalid: Bool
    private let isDisabled: Bool
    private let input: Input
    private let addon: Addon

    /// - Parameters:
    ///   - align: Where the addon sits relative to the input.
    ///   - isInvalid: Draws the destructive border (the error text belongs to the surrounding `AedstField`).
    public init(
        align: AedstInputGroupAlign = .inlineStart,
        isInvalid: Bool = false,
        isDisabled: Bool = false,
        @ViewBuilder input: () -> Input,
        @ViewBuilder addon: () -> Addon
    ) {
        self.align = align
        self.isInvalid = isInvalid
        self.isDisabled = isDisabled
        self.input = input()
        self.addon = addon()
    }

    public var body: some View {
        Group {
            switch align {
            case .inlineStart:
                HStack(spacing: AedstSpacing.sm) {
                    addon
                    input
                }
            case .inlineEnd:
                HStack(spacing: AedstSpacing.sm) {
                    input
                    addon
                }
            case .blockStart:
                VStack(alignment: .leading, spacing: AedstSpacing.xs) {
                    addon
                    input
                }
            case .blockEnd:
                VStack(alignment: .leading, spacing: AedstSpacing.xs) {
                    input
                    addon
                }
            }
        }
        .padding(.horizontal, AedstSpacing.sm)
        .padding(.vertical, AedstSpacing.xxs)
        .frame(maxWidth: .infinity, minHeight: AedstHitTarget.minimum, alignment: .leading)
        .background(AedstDisabledStyle.fill(AedstColor.background, isDisabled: isDisabled))
        .clipShape(RoundedRectangle(cornerRadius: AedstRadius.sm, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: AedstRadius.sm, style: .continuous)
                .strokeBorder(
                    isInvalid ? AedstColor.destructive : AedstDisabledStyle.border(AedstColor.input, isDisabled: isDisabled),
                    lineWidth: 1
                )
        }
        .foregroundStyle(AedstDisabledStyle.foreground(AedstColor.foreground, isDisabled: isDisabled))
        .aedstDisabled(isDisabled)
        .accessibilityElement(children: .contain)
    }
}

/// Borderless text input for the `input` slot of an `AedstInputGroup` (`InputGroupInput`).
public struct AedstInputGroupInput: View {
    private let label: String
    @Binding private var text: String
    private let placeholder: String

    /// - Parameter label: Accessibility label; also the placeholder when `placeholder` is empty.
    public init(_ label: String, text: Binding<String>, placeholder: String = "") {
        self.label = label
        self._text = text
        self.placeholder = placeholder
    }

    public var body: some View {
        TextField(placeholder.isEmpty ? label : placeholder, text: $text)
            .font(AedstTypography.body)
            .textFieldStyle(.plain)
            .frame(maxWidth: .infinity, minHeight: AedstSpacing.xxxl)
            .accessibilityLabel(Text(label))
    }
}

/// Muted text or symbol inside an addon (`InputGroupText`): a unit, a prefix, a search icon.
public struct AedstInputGroupText: View {
    private let text: String?
    private let systemImage: String?

    /// - Parameters:
    ///   - text: Already localized text ("https://", "USD").
    ///   - systemImage: Decorative SF Symbol shown before the text.
    public init(_ text: String? = nil, systemImage: String? = nil) {
        self.text = text
        self.systemImage = systemImage
    }

    public var body: some View {
        HStack(spacing: AedstSpacing.xs) {
            if let systemImage {
                Image(systemName: systemImage)
                    .accessibilityHidden(true)
            }
            if let text {
                Text(text)
            }
        }
        .font(AedstTypography.body)
        .foregroundStyle(AedstColor.mutedForeground)
    }
}

/// Compact button inside an addon (`InputGroupButton`): clear, copy, show password.
public struct AedstInputGroupButton: View {
    private let title: String
    private let systemImage: String?
    private let variant: AedstButtonVariant
    private let size: AedstInputGroupSize
    private let action: () -> Void

    /// - Parameter title: Already localized title; only the accessibility label for the `icon*` sizes.
    public init(
        _ title: String,
        systemImage: String? = nil,
        variant: AedstButtonVariant = .ghost,
        size: AedstInputGroupSize = .xs,
        action: @escaping () -> Void
    ) {
        self.title = title
        self.systemImage = systemImage
        self.variant = variant
        self.size = size
        self.action = action
    }

    public var body: some View {
        AedstButton(
            title,
            systemImage: systemImage,
            variant: variant,
            size: size.buttonSize,
            fillsWidth: false,
            action: action
        )
    }
}

#Preview("AedstInputGroup") {
    @Previewable @State var query = ""
    @Previewable @State var site = "aedst.dev"
    @Previewable @State var message = ""
    VStack(spacing: AedstSpacing.lg) {
        AedstInputGroup {
            AedstInputGroupInput("Search", text: $query)
        } addon: {
            AedstInputGroupText(systemImage: "magnifyingglass")
        }
        AedstInputGroup(align: .inlineEnd) {
            AedstInputGroupInput("Website", text: $site)
        } addon: {
            AedstInputGroupButton("Copy", systemImage: "doc.on.doc", size: .iconXs) {}
        }
        AedstInputGroup(align: .blockEnd, isInvalid: true) {
            AedstInputGroupInput("Message", text: $message, placeholder: "Ask anything")
        } addon: {
            AedstInputGroupButton("Send", variant: .default, size: .sm) {}
        }
    }
    .padding()
}

#endif
