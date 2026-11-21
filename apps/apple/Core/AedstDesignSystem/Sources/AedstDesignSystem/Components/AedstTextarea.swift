import SwiftUI

// iOS, macOS and visionOS only: tvOS and watchOS are scaffolded package platforms without app targets.
#if os(iOS) || os(macOS) || os(visionOS)

/// Multi-line text input matching shadcn/ui `Textarea`: the same label, helper and error slots as
/// `AedstTextField`. Built on `TextField(axis: .vertical)` (not `TextEditor`) because it has a native
/// placeholder and grows with its content between `minLines` and `maxLines`, then scrolls.
public struct AedstTextarea: View {
    private let label: String
    @Binding private var text: String
    private let placeholder: String
    private let errorMessage: String?
    private let helperText: String?
    private let minLines: Int
    private let maxLines: Int
    private let isDisabled: Bool

    /// - Parameters:
    ///   - minLines: Height of the empty field, in lines.
    ///   - maxLines: The field grows up to this many lines and scrolls after that.
    public init(
        _ label: String,
        text: Binding<String>,
        placeholder: String = "",
        errorMessage: String? = nil,
        helperText: String? = nil,
        minLines: Int = 3,
        maxLines: Int = 8,
        isDisabled: Bool = false
    ) {
        self.label = label
        self._text = text
        self.placeholder = placeholder
        self.errorMessage = errorMessage
        self.helperText = helperText
        self.minLines = max(1, minLines)
        self.maxLines = max(max(1, minLines), maxLines)
        self.isDisabled = isDisabled
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: AedstSpacing.xxs) {
            AedstLabel(label)

            TextField(placeholder.isEmpty ? label : placeholder, text: $text, axis: .vertical)
                .lineLimit(minLines...maxLines)
                .font(AedstTypography.body)
                .textFieldStyle(.plain)
                .disabled(isDisabled)
                .padding(.horizontal, AedstSpacing.sm)
                .padding(.vertical, AedstSpacing.sm)
                .frame(minHeight: AedstHitTarget.minimum, alignment: .topLeading)
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

#Preview("AedstTextarea") {
    @Previewable @State var bio = ""
    VStack(spacing: AedstSpacing.lg) {
        AedstTextarea("Bio", text: $bio, placeholder: "Tell us about yourself", helperText: "Up to 500 characters.")
        AedstTextarea("Comment", text: .constant("Too short"), errorMessage: "Write at least 20 characters.")
        AedstTextarea("Disabled", text: .constant("Read only"), isDisabled: true)
    }
    .padding()
}

#endif
