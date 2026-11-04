import SwiftUI

/// Labeled text field with an inline error slot — every form field uses
/// this instead of a bare `TextField` so validation messages render
/// identically across features.
public struct AedstTextField: View {
    private let label: String
    @Binding private var text: String
    private let placeholder: String
    private let errorMessage: String?
    private let helperText: String?
    private let isSecure: Bool
    private let isDisabled: Bool

    public init(
        _ label: String,
        text: Binding<String>,
        placeholder: String = "",
        errorMessage: String? = nil,
        helperText: String? = nil,
        isSecure: Bool = false,
        isDisabled: Bool = false
    ) {
        self.label = label
        self._text = text
        self.placeholder = placeholder
        self.errorMessage = errorMessage
        self.helperText = helperText
        self.isSecure = isSecure
        self.isDisabled = isDisabled
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: AedstSpacing.xxs) {
            AedstLabel(label)

            Group {
                if isSecure {
                    SecureField(placeholder.isEmpty ? label : placeholder, text: $text)
                } else {
                    TextField(placeholder.isEmpty ? label : placeholder, text: $text)
                }
            }
            .font(AedstTypography.body)
            .textFieldStyle(.plain)
            .disabled(isDisabled)
            .padding(.horizontal, AedstSpacing.sm)
            .frame(minHeight: 44)
            .background(AedstColor.background)
            .clipShape(RoundedRectangle(cornerRadius: AedstRadius.sm, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: AedstRadius.sm, style: .continuous)
                    .strokeBorder(errorMessage != nil ? AedstColor.destructive : AedstColor.border, lineWidth: 1)
            }
            .opacity(isDisabled ? 0.5 : 1)

            if let errorMessage {
                Text(errorMessage)
                    .font(AedstTypography.caption)
                    .foregroundStyle(AedstColor.destructive)
                    .accessibilityLabel(Text(AedstStrings.errorPrefix(errorMessage)))
            } else if let helperText {
                Text(helperText)
                    .font(AedstTypography.caption)
                    .foregroundStyle(AedstColor.mutedForeground)
            }
        }
        .accessibilityElement(children: .combine)
        .onChange(of: errorMessage) { previous, current in
            // A new validation message is spoken when it appears; VoiceOver does not read it on its own.
            if let text = AedstAnnouncementPolicy.announcement(previous: previous, current: current) {
                AedstAnnouncer.post(text)
            }
        }
    }
}

#Preview("AedstTextField — Light") {
    VStack(spacing: AedstSpacing.lg) {
        AedstTextField("Email", text: .constant("hi@aedst.dev"), helperText: "We'll never share this.")
        AedstTextField("Password", text: .constant(""), errorMessage: "Required", isSecure: true)
        AedstTextField("Disabled", text: .constant("locked"), isDisabled: true)
    }
    .padding()
    .preferredColorScheme(.light)
}

#Preview("AedstTextField — Dark") {
    AedstTextField("Email", text: .constant("hi@aedst.dev"))
        .padding()
        .preferredColorScheme(.dark)
}
