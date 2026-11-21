import SwiftUI

// iOS, macOS and visionOS only: tvOS and watchOS are scaffolded package platforms without app targets.
#if os(iOS) || os(macOS) || os(visionOS)

/// Inline month grid matching shadcn/ui `Calendar`: the native graphical `DatePicker` with the kit's tint.
/// The calendar system, first weekday, numerals and right-to-left month order come from the environment's
/// `calendar` and `locale`, so nothing is laid out by hand. Use `AedstDatePicker` for a compact form field.
public struct AedstCalendar: View {
    private let label: String
    @Binding private var selection: Date
    private let range: ClosedRange<Date>?
    private let isDisabled: Bool

    /// - Parameters:
    ///   - label: Already localized name of the calendar; not drawn, read by assistive technologies.
    ///   - selection: The selected day.
    ///   - range: Selectable days; `nil` allows any day.
    public init(
        _ label: String,
        selection: Binding<Date>,
        in range: ClosedRange<Date>? = nil,
        isDisabled: Bool = false
    ) {
        self.label = label
        self._selection = selection
        self.range = range
        self.isDisabled = isDisabled
    }

    public var body: some View {
        Group {
            if let range {
                DatePicker(label, selection: $selection, in: range, displayedComponents: .date)
            } else {
                DatePicker(label, selection: $selection, displayedComponents: .date)
            }
        }
        .datePickerStyle(.graphical)
        .labelsHidden()
        .tint(AedstColor.primary)
        .disabled(isDisabled)
        .opacity(isDisabled ? 0.5 : 1)
        .accessibilityLabel(Text(label))
    }
}

#Preview("AedstCalendar") {
    @Previewable @State var date = Date(timeIntervalSinceReferenceDate: 800_000_000)
    AedstCalendar("Due date", selection: $date)
        .padding()
}

#endif
