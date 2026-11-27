import SwiftUI

// iOS, macOS and visionOS only: tvOS and watchOS are scaffolded package platforms without app targets.
#if os(iOS) || os(macOS) || os(visionOS)

/// Mirrors shadcn/ui `Toggle`'s `variant` prop (`ui-kit.yaml`: default, outline).
public enum AedstToggleVariant: Sendable, CaseIterable {
    /// Transparent until pressed.
    case `default`
    /// Transparent with a border.
    case outline
}

/// Mirrors shadcn/ui `Toggle`'s `size` prop (`ui-kit.yaml`: default, sm, lg).
public enum AedstToggleSize: Sendable, CaseIterable {
    case `default`
    case sm
    case lg

    /// Height of the drawn chrome; the tappable area is at least 44 pt on touch platforms.
    var minHeight: CGFloat {
        switch self {
        case .sm: 32
        case .default: 36
        case .lg: 44
        }
    }

    var font: Font {
        switch self {
        case .sm: AedstTypography.caption
        case .default, .lg: AedstTypography.body
        }
    }

    var horizontalPadding: CGFloat {
        switch self {
        case .sm: AedstSpacing.sm
        case .default, .lg: AedstSpacing.md
        }
    }
}

/// Two-state button matching shadcn/ui `Toggle` (bold, italic, a filter that is on or off). For an on/off
/// setting with a label use `AedstSwitch`.
public struct AedstToggle: View {
    private let title: String
    private let systemImage: String?
    @Binding private var isOn: Bool
    private let variant: AedstToggleVariant
    private let size: AedstToggleSize
    private let showsTitle: Bool
    private let isDisabled: Bool

    /// - Parameters:
    ///   - title: Already localized title; always the accessibility label.
    ///   - systemImage: Optional SF Symbol.
    ///   - showsTitle: `false` draws only the symbol (pass `systemImage`).
    public init(
        _ title: String,
        systemImage: String? = nil,
        isOn: Binding<Bool>,
        variant: AedstToggleVariant = .default,
        size: AedstToggleSize = .default,
        showsTitle: Bool = true,
        isDisabled: Bool = false
    ) {
        self.title = title
        self.systemImage = systemImage
        self._isOn = isOn
        self.variant = variant
        self.size = size
        self.showsTitle = showsTitle
        self.isDisabled = isDisabled
    }

    public var body: some View {
        Button {
            isOn.toggle()
        } label: {
            HStack(spacing: AedstSpacing.xs) {
                if let systemImage {
                    Image(systemName: systemImage)
                        .accessibilityHidden(true)
                }
                if showsTitle || systemImage == nil {
                    Text(title)
                }
            }
            .font(size.font.weight(.medium))
            .padding(.horizontal, size.horizontalPadding)
            .aedstScaledMinFrame(minWidth: size.minHeight, minHeight: size.minHeight)
            .background(isOn ? AedstColor.muted : Color.clear)
            .foregroundStyle(AedstDisabledStyle.foreground(AedstColor.foreground, isDisabled: isDisabled))
            .clipShape(RoundedRectangle(cornerRadius: AedstRadius.md, style: .continuous))
            .overlay {
                if variant == .outline {
                    RoundedRectangle(cornerRadius: AedstRadius.md, style: .continuous)
                        .strokeBorder(AedstColor.input, lineWidth: 1)
                }
            }
            .aedstHitTarget()
        }
        .buttonStyle(AedstPressableButtonStyle(cornerRadius: AedstRadius.md))
        .aedstHaptic(.selection, trigger: isOn)
        .aedstDisabled(isDisabled)
        .aedstAnimation(.easeInOut(duration: AedstMotion.durationFast), value: isOn)
        .accessibilityLabel(Text(title))
        .accessibilityAddTraits(isOn ? [.isToggle, .isSelected] : .isToggle)
    }
}

#Preview("AedstToggle") {
    @Previewable @State var isBold = true
    @Previewable @State var isItalic = false
    VStack(alignment: .leading, spacing: AedstSpacing.sm) {
        HStack(spacing: AedstSpacing.sm) {
            AedstToggle("Bold", systemImage: "bold", isOn: $isBold, showsTitle: false)
            AedstToggle("Italic", systemImage: "italic", isOn: $isItalic, variant: .outline, showsTitle: false)
        }
        AedstToggle("Small", isOn: $isBold, size: .sm)
        AedstToggle("Default", isOn: $isItalic, variant: .outline)
        AedstToggle("Large", isOn: $isBold, variant: .outline, size: .lg)
        AedstToggle("Disabled", isOn: .constant(false), isDisabled: true)
    }
    .padding()
}

#endif
