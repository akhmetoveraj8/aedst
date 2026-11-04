import SwiftUI

/// `Toggle` wrapper matching shadcn/ui `Switch` styling (tokenized tint
/// instead of the system green) — use for on/off settings.
public struct AedstSwitch: View {
    private let label: String?
    @Binding private var isOn: Bool
    private let isDisabled: Bool

    public init(_ label: String? = nil, isOn: Binding<Bool>, isDisabled: Bool = false) {
        self.label = label
        self._isOn = isOn
        self.isDisabled = isDisabled
    }

    public var body: some View {
        Toggle(isOn: $isOn) {
            if let label {
                Text(label)
                    .font(AedstTypography.body)
            }
        }
        .toggleStyle(.switch)
        .tint(AedstColor.primary)
        .disabled(isDisabled)
        .opacity(isDisabled ? 0.5 : 1)
        .accessibilityLabel(Text(label ?? AedstStrings.switchControl))
    }
}

#Preview("AedstSwitch") {
    VStack(alignment: .leading, spacing: AedstSpacing.sm) {
        AedstSwitch("Enable notifications", isOn: .constant(true))
        AedstSwitch("Airplane mode", isOn: .constant(false))
        AedstSwitch("Disabled", isOn: .constant(true), isDisabled: true)
    }
    .padding()
}
