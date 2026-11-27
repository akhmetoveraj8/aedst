import SwiftUI

// iOS, macOS and visionOS only: tvOS and watchOS are scaffolded package platforms without app targets.
#if os(iOS) || os(macOS) || os(visionOS)

/// Pure rules of the one-time-code field, kept apart from the view so they are unit-tested.
enum AedstInputOTPLogic {
    /// Keeps ASCII digits only and cuts the result to `length` (pasted codes often carry spaces or dashes).
    static func sanitized(_ raw: String, length: Int) -> String {
        let digits: ClosedRange<Character> = "0"..."9"
        return String(raw.filter { digits.contains($0) }.prefix(max(0, length)))
    }

    /// How many of the `length` slots are filled.
    static func enteredCount(in code: String, length: Int) -> Int {
        min(code.count, max(0, length))
    }

    /// The value VoiceOver reads for the field: "3 of 6 digits entered".
    static func spokenValue(code: String, length: Int) -> String {
        AedstStrings.otpDigits(enteredCount(in: code, length: length).formatted(), max(0, length).formatted())
    }

    /// The digit shown in slot `index`, or `nil` for an empty slot.
    static func digit(at index: Int, in code: String) -> String? {
        guard index >= 0, index < code.count else { return nil }
        return String(code[code.index(code.startIndex, offsetBy: index)])
    }
}

/// One-time-code input matching shadcn/ui `InputOTP`: one slot per digit, optionally split into groups.
///
/// One real text field sits under the slots, so the system keyboard, paste, SMS / Mail code AutoFill
/// (`.oneTimeCode`) and VoiceOver work as for any text field; the slots only draw the digits. Digits always
/// run left to right, also in right-to-left languages.
public struct AedstInputOTP: View {
    private let label: String
    @Binding private var code: String
    private let length: Int
    private let groupSize: Int?
    private let errorMessage: String?
    private let isDisabled: Bool
    private let onComplete: ((String) -> Void)?

    @FocusState private var isFocused: Bool

    /// - Parameters:
    ///   - label: Accessibility label; defaults to the localized "One-time code".
    ///   - length: Number of digits.
    ///   - groupSize: Digits per visual group (`3` draws `123 - 456`); `nil` draws one group.
    ///   - onComplete: Called once the last digit is entered.
    public init(
        _ label: String? = nil,
        code: Binding<String>,
        length: Int = 6,
        groupSize: Int? = nil,
        errorMessage: String? = nil,
        isDisabled: Bool = false,
        onComplete: ((String) -> Void)? = nil
    ) {
        self.label = label ?? AedstStrings.oneTimeCode
        self._code = code
        self.length = max(1, length)
        self.groupSize = groupSize.map { max(1, $0) }
        self.errorMessage = errorMessage
        self.isDisabled = isDisabled
        self.onComplete = onComplete
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: AedstSpacing.xxs) {
            ZStack(alignment: .leading) {
                field
                slots
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
            }
            // Codes are numbers: slot order does not mirror in right-to-left layouts.
            .environment(\.layoutDirection, .leftToRight)

            if let errorMessage {
                Text(errorMessage)
                    .font(AedstTypography.caption)
                    .foregroundStyle(AedstColor.destructive)
                    .accessibilityLabel(Text(AedstStrings.errorPrefix(errorMessage)))
            }
        }
        .onChange(of: code) { _, newValue in
            let clean = AedstInputOTPLogic.sanitized(newValue, length: length)
            if clean != newValue {
                code = clean
            } else if clean.count == length {
                onComplete?(clean)
            }
        }
        .onChange(of: errorMessage) { previous, current in
            if let text = AedstAnnouncementPolicy.announcement(previous: previous, current: current) {
                AedstAnnouncer.post(text)
            }
        }
    }

    /// The real input. Its own text and caret are transparent: the slots above draw the digits.
    private var field: some View {
        TextField(label, text: $code)
            .textFieldStyle(.plain)
            .textContentType(.oneTimeCode)
            #if os(iOS) || os(visionOS)
            .keyboardType(.numberPad)
            #endif
            .autocorrectionDisabled()
            .focused($isFocused)
            .aedstDisabled(isDisabled)
            .foregroundStyle(Color.clear)
            .tint(Color.clear)
            .aedstScaledMinFrame(minHeight: AedstHitTarget.minimum)
            .frame(maxWidth: .infinity)
            // The real field is what VoiceOver sees: the slots are hidden, so the filled count is its value.
            .accessibilityLabel(Text(label))
            .accessibilityValue(Text(AedstInputOTPLogic.spokenValue(code: code, length: length)))
    }

    private var slots: some View {
        HStack(spacing: AedstSpacing.xs) {
            ForEach(0..<length, id: \.self) { index in
                if let groupSize, index > 0, index.isMultiple(of: groupSize) {
                    Rectangle()
                        .fill(AedstColor.mutedForeground)
                        .frame(width: AedstSpacing.sm, height: AedstSpacing.xxs)
                }
                slot(index)
            }
        }
    }

    private func slot(_ index: Int) -> some View {
        let isActive = isFocused && index == min(code.count, length - 1)
        return Text(AedstInputOTPLogic.digit(at: index, in: code) ?? " ")
            .font(AedstTypography.headline)
            .monospacedDigit()
            .foregroundStyle(AedstDisabledStyle.foreground(AedstColor.foreground, isDisabled: isDisabled))
            .frame(minWidth: AedstHitTarget.minimum)
            .aedstScaledMinFrame(minHeight: AedstHitTarget.minimum)
            .background(AedstDisabledStyle.fill(AedstColor.background, isDisabled: isDisabled))
            .clipShape(RoundedRectangle(cornerRadius: AedstRadius.sm, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: AedstRadius.sm, style: .continuous)
                    .strokeBorder(borderColor(isActive: isActive), lineWidth: isActive ? 2 : 1)
            }
    }

    private func borderColor(isActive: Bool) -> Color {
        if errorMessage != nil { return AedstColor.destructive }
        return AedstDisabledStyle.border(isActive ? AedstColor.ring : AedstColor.input, isDisabled: isDisabled)
    }
}

#Preview("AedstInputOTP") {
    @Previewable @State var code = "123"
    @Previewable @State var wrong = "000000"
    VStack(alignment: .leading, spacing: AedstSpacing.lg) {
        AedstInputOTP(code: $code, groupSize: 3)
        AedstInputOTP(code: $wrong, errorMessage: "The code is not valid.")
        AedstInputOTP(code: .constant("12"), length: 4, isDisabled: true)
    }
    .padding()
}

#endif
