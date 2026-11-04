import SwiftUI

/// Form field caption — the small `mutedForeground` text above an input,
/// used by `AedstTextField`/`AedstCheckbox`/`AedstRadioGroup` and standalone.
public struct AedstLabel: View {
    private let text: String
    private let isRequired: Bool

    public init(_ text: String, isRequired: Bool = false) {
        self.text = text
        self.isRequired = isRequired
    }

    public var body: some View {
        HStack(spacing: AedstSpacing.xxs) {
            Text(text)
                .font(AedstTypography.caption.weight(.medium))
                .foregroundStyle(AedstColor.mutedForeground)
            if isRequired {
                Text("*")
                    .font(AedstTypography.caption.weight(.medium))
                    .foregroundStyle(AedstColor.destructive)
            }
        }
    }
}

#Preview("AedstLabel") {
    VStack(alignment: .leading, spacing: AedstSpacing.sm) {
        AedstLabel("Email")
        AedstLabel("Password", isRequired: true)
    }
    .padding()
}
