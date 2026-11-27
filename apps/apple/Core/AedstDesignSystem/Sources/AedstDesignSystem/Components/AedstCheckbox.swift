import SwiftUI

/// Custom checkbox — SwiftUI has no native checkbox on iOS/tvOS/watchOS, so
/// this draws a `RoundedRectangle` box with a checkmark, matching shadcn/ui
/// `Checkbox`'s square (not circular) shape.
public struct AedstCheckbox: View {
    private let label: String?
    @Binding private var isChecked: Bool
    private let isDisabled: Bool

    public init(_ label: String? = nil, isChecked: Binding<Bool>, isDisabled: Bool = false) {
        self.label = label
        self._isChecked = isChecked
        self.isDisabled = isDisabled
    }

    public var body: some View {
        Button {
            isChecked.toggle()
        } label: {
            HStack(spacing: AedstSpacing.xs) {
                RoundedRectangle(cornerRadius: AedstRadius.xs, style: .continuous)
                    .fill(isChecked ? AedstDisabledStyle.mark(AedstColor.primary, isDisabled: isDisabled) : Color.clear)
                    .aedstScaledFrame(width: 20, height: 20)
                    .overlay {
                        RoundedRectangle(cornerRadius: AedstRadius.xs, style: .continuous)
                            .strokeBorder(
                                AedstDisabledStyle.border(isChecked ? AedstColor.primary : AedstColor.border, isDisabled: isDisabled),
                                lineWidth: 1.5
                            )
                    }
                    .overlay {
                        if isChecked {
                            Image(systemName: "checkmark")
                                .font(.caption.weight(.bold))
                                .foregroundStyle(AedstDisabledStyle.onMark(AedstColor.primaryForeground, isDisabled: isDisabled))
                        }
                    }

                if let label {
                    Text(label)
                        .font(AedstTypography.body)
                        .foregroundStyle(AedstDisabledStyle.foreground(AedstColor.foreground, isDisabled: isDisabled))
                }
            }
        }
        .buttonStyle(AedstPressableButtonStyle(cornerRadius: AedstRadius.xs))
        .aedstHaptic(.selection, trigger: isChecked)
        .aedstDisabled(isDisabled)
        .accessibilityLabel(Text(label ?? AedstStrings.checkbox))
        .accessibilityAddTraits(.isButton)
        .accessibilityValue(Text(Self.accessibilityValue(isChecked: isChecked)))
    }

    /// What VoiceOver says for the state ("Checked" / "Unchecked").
    static func accessibilityValue(isChecked: Bool) -> String {
        isChecked ? AedstStrings.checked : AedstStrings.unchecked
    }
}

#Preview("AedstCheckbox") {
    VStack(alignment: .leading, spacing: AedstSpacing.sm) {
        AedstCheckbox("Accept terms", isChecked: .constant(true))
        AedstCheckbox("Subscribe to newsletter", isChecked: .constant(false))
        AedstCheckbox("Disabled", isChecked: .constant(false), isDisabled: true)
    }
    .padding()
}
