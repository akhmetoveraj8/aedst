import SwiftUI

// iOS, macOS and visionOS only: tvOS and watchOS are scaffolded package platforms without app targets.
#if os(iOS) || os(macOS) || os(visionOS)

/// What an `AedstDatePicker` lets the user pick.
public enum AedstDatePickerComponents: Sendable, CaseIterable {
    case date
    case time
    case dateAndTime

    var components: DatePickerComponents {
        switch self {
        case .date: .date
        case .time: .hourAndMinute
        case .dateAndTime: [.date, .hourAndMinute]
        }
    }
}

/// Date form field matching shadcn/ui `DatePicker` (a button that opens a calendar): the native compact
/// `DatePicker`, which opens the system calendar popover on iOS, iPadOS and macOS, with the kit's label,
/// helper and error slots so it lines up with `AedstTextField` in a form. Formatting follows the
/// environment's `locale` and `calendar`.
public struct AedstDatePicker: View {
    private let label: String
    @Binding private var selection: Date
    private let range: ClosedRange<Date>?
    private let components: AedstDatePickerComponents
    private let errorMessage: String?
    private let helperText: String?
    private let isDisabled: Bool

    /// - Parameters:
    ///   - label: Already localized field label.
    ///   - selection: The selected date.
    ///   - range: Selectable dates; `nil` allows any date.
    ///   - errorMessage: Validation message; replaces the helper text and is announced when it appears.
    public init(
        _ label: String,
        selection: Binding<Date>,
        in range: ClosedRange<Date>? = nil,
        components: AedstDatePickerComponents = .date,
        errorMessage: String? = nil,
        helperText: String? = nil,
        isDisabled: Bool = false
    ) {
        self.label = label
        self._selection = selection
        self.range = range
        self.components = components
        self.errorMessage = errorMessage
        self.helperText = helperText
        self.isDisabled = isDisabled
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: AedstSpacing.xxs) {
            AedstLabel(label)
                .accessibilityHidden(true)

            Group {
                if let range {
                    DatePicker(label, selection: $selection, in: range, displayedComponents: components.components)
                } else {
                    DatePicker(label, selection: $selection, displayedComponents: components.components)
                }
            }
            .datePickerStyle(.compact)
            .labelsHidden()
            .tint(AedstColor.primary)
            .aedstDisabled(isDisabled)
            .frame(minHeight: AedstHitTarget.minimum)
            .accessibilityLabel(Text(label))

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
        .onChange(of: errorMessage) { previous, current in
            // A new validation message is spoken when it appears; VoiceOver does not read it on its own.
            if let text = AedstAnnouncementPolicy.announcement(previous: previous, current: current) {
                AedstAnnouncer.post(text)
            }
        }
    }
}

#Preview("AedstDatePicker") {
    @Previewable @State var date = Date(timeIntervalSinceReferenceDate: 800_000_000)
    VStack(alignment: .leading, spacing: AedstSpacing.lg) {
        AedstDatePicker("Due date", selection: $date, helperText: "Tasks are due at the end of the day.")
        AedstDatePicker("Reminder", selection: $date, components: .dateAndTime, errorMessage: "Pick a future time.")
        AedstDatePicker("Locked", selection: $date, isDisabled: true)
    }
    .padding()
}

#endif
