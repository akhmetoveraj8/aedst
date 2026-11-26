import SwiftUI

// iOS, macOS and visionOS only: tvOS and watchOS are scaffolded package platforms without app targets.
#if os(iOS) || os(macOS) || os(visionOS)

/// Mirrors shadcn/ui `Field`'s `orientation` axis (`ui-kit.yaml`: vertical, horizontal, responsive).
public enum AedstFieldOrientation: Sendable, CaseIterable {
    /// Label above the control.
    case vertical
    /// Label and control on one row (switches, checkboxes, compact selects).
    case horizontal
    /// Horizontal when the row fits the available width, vertical otherwise (narrow windows, large text).
    case responsive
}

/// shadcn/ui `FieldLegend` `variant`: `legend` titles a whole group (`text-base`), `label` makes the legend read
/// like one field label (`text-sm`) when the set is a single question such as a radio group.
public enum AedstFieldLegendVariant: Sendable, CaseIterable {
    case legend
    case label

    var font: Font {
        switch self {
        case .legend: AedstTypography.headline
        case .label: AedstTypography.body.weight(.medium)
        }
    }

    /// Gap between the legend block and the fields (web `mb-1.5` plus the group gap; tighter for a label legend).
    var contentSpacing: CGFloat {
        switch self {
        case .legend: AedstSpacing.lg
        case .label: AedstSpacing.sm
        }
    }
}

/// Label, description and error around any control, matching shadcn/ui `Field` (`FieldLabel`,
/// `FieldDescription`, `FieldError`). `AedstTextField` and `AedstTextarea` already carry these slots; use
/// `AedstField` for every other control (switch, slider, picker, toggle group) so forms line up.
public struct AedstField<Control: View>: View {
    private let label: String
    private let description: String?
    private let errorMessage: String?
    private let isRequired: Bool
    private let orientation: AedstFieldOrientation
    private let control: Control

    /// - Parameters:
    ///   - label: Already localized label.
    ///   - description: Helper text under the label (horizontal) or under the control (vertical).
    ///   - errorMessage: Validation message; replaces the description and is announced when it appears.
    public init(
        _ label: String,
        description: String? = nil,
        errorMessage: String? = nil,
        isRequired: Bool = false,
        orientation: AedstFieldOrientation = .vertical,
        @ViewBuilder control: () -> Control
    ) {
        self.label = label
        self.description = description
        self.errorMessage = errorMessage
        self.isRequired = isRequired
        self.orientation = orientation
        self.control = control()
    }

    public var body: some View {
        Group {
            switch orientation {
            case .vertical:
                vertical
            case .horizontal:
                horizontal
            case .responsive:
                ViewThatFits(in: .horizontal) {
                    horizontal
                    vertical
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(isRequired ? "\(label), \(AedstStrings.required)" : label))
        .onChange(of: errorMessage) { previous, current in
            // A new validation message is spoken when it appears; VoiceOver does not read it on its own.
            if let text = AedstAnnouncementPolicy.announcement(previous: previous, current: current) {
                AedstAnnouncer.post(text)
            }
        }
    }

    private var vertical: some View {
        VStack(alignment: .leading, spacing: AedstSpacing.xs) {
            AedstLabel(label, isRequired: isRequired)
            control
            supportingText
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var horizontal: some View {
        VStack(alignment: .leading, spacing: AedstSpacing.xs) {
            HStack(alignment: .center, spacing: AedstSpacing.md) {
                VStack(alignment: .leading, spacing: AedstSpacing.xxs) {
                    AedstLabel(label, isRequired: isRequired)
                    if errorMessage == nil, let description {
                        descriptionText(description)
                    }
                }
                Spacer(minLength: AedstSpacing.sm)
                control
            }
            if let errorMessage {
                errorText(errorMessage)
            }
        }
    }

    @ViewBuilder private var supportingText: some View {
        if let errorMessage {
            errorText(errorMessage)
        } else if let description {
            descriptionText(description)
        }
    }

    private func descriptionText(_ text: String) -> some View {
        Text(text)
            .font(AedstTypography.caption)
            .foregroundStyle(AedstColor.mutedForeground)
    }

    private func errorText(_ text: String) -> some View {
        Text(text)
            .font(AedstTypography.caption)
            .foregroundStyle(AedstColor.destructive)
            .accessibilityLabel(Text(AedstStrings.errorPrefix(text)))
    }
}

/// Group of related fields with a legend, matching shadcn/ui `FieldSet` + `FieldLegend` + `FieldGroup`.
public struct AedstFieldSet<Content: View>: View {
    private let legend: String
    private let description: String?
    private let legendVariant: AedstFieldLegendVariant
    private let content: Content

    /// - Parameter legendVariant: `.label` for a set that is one question (a radio group), `.legend` for a section.
    public init(
        _ legend: String,
        description: String? = nil,
        legendVariant: AedstFieldLegendVariant = .legend,
        @ViewBuilder content: () -> Content
    ) {
        self.legend = legend
        self.description = description
        self.legendVariant = legendVariant
        self.content = content()
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: legendVariant.contentSpacing) {
            VStack(alignment: .leading, spacing: AedstSpacing.xxs) {
                Text(legend)
                    .font(legendVariant.font)
                    .foregroundStyle(AedstColor.foreground)
                    .accessibilityAddTraits(.isHeader)
                if let description {
                    Text(description)
                        .font(AedstTypography.caption)
                        .foregroundStyle(AedstColor.mutedForeground)
                }
            }
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
    }
}

#Preview("AedstField") {
    @Previewable @State var marketing = true
    @Previewable @State var volume = 0.4
    AedstFieldSet("Notifications", description: "Choose what we may send you.") {
        AedstField("Marketing emails", description: "Product news, at most monthly.", orientation: .horizontal) {
            AedstSwitch("Marketing emails", isOn: $marketing).labelsHidden()
        }
        AedstField("Volume", errorMessage: "Too loud for this room.", isRequired: true) {
            AedstSlider("Volume", value: $volume, showsLabel: false)
        }
        AedstField("Security alerts", description: "Always on.", orientation: .responsive) {
            AedstSwitch("Security alerts", isOn: .constant(true), isDisabled: true).labelsHidden()
        }
    }
    .padding()
}

#Preview("AedstFieldSet — label legend") {
    @Previewable @State var plan = "free"
    AedstFieldSet("Plan", legendVariant: .label) {
        AedstNativeSelect(
            "Plan",
            options: [AedstSelectOption(id: "free", title: "Free"), AedstSelectOption(id: "pro", title: "Pro")],
            selection: $plan
        )
    }
    .padding()
}

#endif
