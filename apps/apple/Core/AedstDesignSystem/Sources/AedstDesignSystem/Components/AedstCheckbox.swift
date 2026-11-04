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
                    .fill(isChecked ? AedstColor.primary : Color.clear)
                    .frame(width: 20, height: 20)
                    .overlay {
                        RoundedRectangle(cornerRadius: AedstRadius.xs, style: .continuous)
                            .strokeBorder(isChecked ? AedstColor.primary : AedstColor.border, lineWidth: 1.5)
                    }
                    .overlay {
                        if isChecked {
                            Image(systemName: "checkmark")
                                .font(.caption.weight(.bold))
                                .foregroundStyle(AedstColor.primaryForeground)
                        }
                    }

                if let label {
                    Text(label)
                        .font(AedstTypography.body)
                        .foregroundStyle(AedstColor.foreground)
                }
            }
        }
        #if os(macOS)
        .buttonStyle(.plain)
        #endif
        .disabled(isDisabled)
        .opacity(isDisabled ? 0.5 : 1)
        .accessibilityLabel(Text(label ?? AedstStrings.checkbox))
        .accessibilityAddTraits(.isButton)
        .accessibilityValue(Text(isChecked ? AedstStrings.checked : AedstStrings.unchecked))
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
