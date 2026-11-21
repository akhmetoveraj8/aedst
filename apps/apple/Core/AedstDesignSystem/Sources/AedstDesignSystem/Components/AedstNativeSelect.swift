import SwiftUI

// iOS, macOS and visionOS only: tvOS and watchOS are scaffolded package platforms without app targets.
#if os(iOS) || os(macOS) || os(visionOS)

/// A titled run of options in `AedstNativeSelect` (shadcn/ui `NativeSelectOptGroup`).
public struct AedstNativeSelectGroup: Identifiable, Sendable {
    public let id: String
    let title: String
    let options: [AedstSelectOption]

    /// - Parameters:
    ///   - title: Already localized heading; an empty title renders the options without one.
    ///   - id: Stable identity; defaults to the title.
    public init(_ title: String = "", id: String? = nil, options: [AedstSelectOption]) {
        self.id = id ?? title
        self.title = title
        self.options = options
    }
}

/// The platform's own picker, matching shadcn/ui `NativeSelect` (a styled `<select>` on the web): SwiftUI
/// `Picker` in the menu style with the system chrome, only tinted and labelled by the kit.
///
/// Prefer it inside system containers (`Form`, settings rows, toolbars) where the native look is expected;
/// `AedstSelect` is the variant that matches the kit's text fields. A value is always selected here, as with
/// an HTML select without an empty option.
public struct AedstNativeSelect: View {
    private let label: String
    private let groups: [AedstNativeSelectGroup]
    @Binding private var selection: String
    private let isDisabled: Bool

    /// - Parameters:
    ///   - label: Already localized field label, shown above the control and read by VoiceOver.
    ///   - groups: Options in titled groups.
    ///   - selection: `id` of the chosen option.
    public init(
        _ label: String,
        groups: [AedstNativeSelectGroup],
        selection: Binding<String>,
        isDisabled: Bool = false
    ) {
        self.label = label
        self.groups = groups
        self._selection = selection
        self.isDisabled = isDisabled
    }

    /// A flat list of options.
    public init(
        _ label: String,
        options: [AedstSelectOption],
        selection: Binding<String>,
        isDisabled: Bool = false
    ) {
        self.init(
            label,
            groups: [AedstNativeSelectGroup(options: options)],
            selection: selection,
            isDisabled: isDisabled
        )
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: AedstSpacing.xxs) {
            AedstLabel(label)
                .accessibilityHidden(true)

            Picker(label, selection: $selection) {
                ForEach(groups) { group in
                    if group.title.isEmpty {
                        rows(group.options)
                    } else {
                        Section(group.title) {
                            rows(group.options)
                        }
                    }
                }
            }
            .pickerStyle(.menu)
            .labelsHidden()
            .tint(AedstColor.foreground)
            .frame(minHeight: AedstHitTarget.minimum)
            .disabled(isDisabled)
            .accessibilityLabel(Text(label))
        }
    }

    private func rows(_ options: [AedstSelectOption]) -> some View {
        ForEach(options) { option in
            Text(option.title)
                .tag(option.id)
                .selectionDisabled(option.isDisabled)
        }
    }
}

#Preview("AedstNativeSelect") {
    @Previewable @State var status = "todo"
    @Previewable @State var zone = "utc"
    VStack(alignment: .leading, spacing: AedstSpacing.lg) {
        AedstNativeSelect(
            "Status",
            options: [
                AedstSelectOption(id: "todo", title: "To do"),
                AedstSelectOption(id: "doing", title: "In progress"),
                AedstSelectOption(id: "done", title: "Done"),
            ],
            selection: $status
        )
        AedstNativeSelect(
            "Time zone",
            groups: [
                AedstNativeSelectGroup("Universal", options: [AedstSelectOption(id: "utc", title: "UTC")]),
                AedstNativeSelectGroup("Asia", options: [
                    AedstSelectOption(id: "dushanbe", title: "Dushanbe"),
                    AedstSelectOption(id: "tashkent", title: "Tashkent"),
                ]),
            ],
            selection: $zone
        )
    }
    .padding()
}

#endif
