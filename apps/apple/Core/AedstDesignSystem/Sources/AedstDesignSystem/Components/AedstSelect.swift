import SwiftUI

// iOS, macOS and visionOS only: tvOS and watchOS are scaffolded package platforms without app targets.
#if os(iOS) || os(macOS) || os(visionOS)

/// One choice of `AedstSelect`, `AedstNativeSelect` or `AedstCombobox` (shadcn/ui `SelectItem`).
public struct AedstSelectOption: Identifiable, Hashable, Sendable {
    /// Stable value stored in the selection binding.
    public let id: String
    /// Already localized title.
    public let title: String
    /// Optional SF Symbol shown with the title.
    public let systemImage: String?
    /// A disabled option is listed but cannot be picked.
    public let isDisabled: Bool

    public init(id: String, title: String, systemImage: String? = nil, isDisabled: Bool = false) {
        self.id = id
        self.title = title
        self.systemImage = systemImage
        self.isDisabled = isDisabled
    }
}

/// shadcn/ui `SelectTrigger` `size`: `default` is 32 pt tall with the `md` radius, `sm` 28 pt with the `sm` radius
/// and tighter padding (macOS). On touch platforms both stay at least 44 pt tall, as web's `pointer-coarse:min-h-11`.
public enum AedstSelectSize: Sendable, CaseIterable {
    case `default`
    case sm

    /// Height of the drawn trigger on a precise-pointer platform.
    var pointerHeight: CGFloat {
        switch self {
        case .default: 32
        case .sm: 28
        }
    }

    /// Height of the drawn trigger on this platform.
    var height: CGFloat {
        #if os(macOS)
        pointerHeight
        #else
        max(pointerHeight, AedstHitTarget.minimum)
        #endif
    }

    var cornerRadius: CGFloat {
        switch self {
        case .default: AedstRadius.md
        case .sm: AedstRadius.sm
        }
    }

    var horizontalPadding: CGFloat {
        switch self {
        case .default: AedstSpacing.sm
        case .sm: AedstSpacing.xs + AedstSpacing.xxs
        }
    }
}

/// The closed state of a select-like control (shadcn/ui `SelectTrigger` + `SelectValue`): the chosen title or
/// a muted placeholder, and an up-down chevron. Shared by `AedstSelect` and `AedstCombobox`.
struct AedstSelectTriggerLabel: View {
    let title: String
    let isPlaceholder: Bool
    let systemImage: String?
    let isInvalid: Bool
    var size: AedstSelectSize = .default
    @Environment(\.isEnabled) private var isEnabled

    var body: some View {
        let isDisabled = !isEnabled
        HStack(spacing: AedstSpacing.xs) {
            if let systemImage {
                Image(systemName: systemImage)
                    .accessibilityHidden(true)
            }
            Text(title)
                .foregroundStyle(
                    isPlaceholder
                        ? AedstColor.mutedForeground
                        : AedstDisabledStyle.foreground(AedstColor.foreground, isDisabled: isDisabled)
                )
                .lineLimit(1)
            Spacer(minLength: AedstSpacing.sm)
            Image(systemName: "chevron.up.chevron.down")
                .font(AedstTypography.caption)
                .foregroundStyle(AedstColor.mutedForeground)
                .accessibilityHidden(true)
        }
        .font(AedstTypography.body)
        .foregroundStyle(AedstDisabledStyle.foreground(AedstColor.foreground, isDisabled: isDisabled))
        .padding(.horizontal, size.horizontalPadding)
        .aedstScaledMinFrame(minHeight: size.height)
        .background(AedstDisabledStyle.fill(AedstColor.background, isDisabled: isDisabled))
        .clipShape(RoundedRectangle(cornerRadius: size.cornerRadius, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: size.cornerRadius, style: .continuous)
                .strokeBorder(
                    isInvalid ? AedstColor.destructive : AedstDisabledStyle.border(AedstColor.border, isDisabled: isDisabled),
                    lineWidth: 1
                )
        }
        .contentShape(Rectangle())
    }
}

/// Single-choice picker matching shadcn/ui `Select`: the kit's own trigger (same height, border and error
/// state as `AedstTextField`) that opens a native menu with a check mark on the current option.
///
/// The list itself is the system menu on every platform (pull-down on iOS, pop-up on macOS), so scrolling
/// long lists, type-to-select on macOS, VoiceOver and right-to-left need no code here. For a searchable list
/// use `AedstCombobox`; for the plain system control use `AedstNativeSelect`.
public struct AedstSelect: View {
    private let label: String
    private let options: [AedstSelectOption]
    @Binding private var selection: String?
    private let placeholder: String
    private let errorMessage: String?
    private let size: AedstSelectSize
    private let isDisabled: Bool

    /// - Parameters:
    ///   - label: Already localized field label, shown above the control and read by VoiceOver.
    ///   - options: Choices, in display order.
    ///   - selection: `id` of the chosen option, `nil` while nothing is chosen.
    ///   - placeholder: Shown while nothing is chosen; `nil` uses the kit's "Select an option".
    ///   - errorMessage: Validation message; also turns the border destructive.
    ///   - size: Trigger height and radius (`.sm` for dense toolbars and tables).
    public init(
        _ label: String,
        options: [AedstSelectOption],
        selection: Binding<String?>,
        placeholder: String? = nil,
        errorMessage: String? = nil,
        size: AedstSelectSize = .default,
        isDisabled: Bool = false
    ) {
        self.label = label
        self.options = options
        self.size = size
        self._selection = selection
        self.placeholder = placeholder ?? AedstStrings.selectOption
        self.errorMessage = errorMessage
        self.isDisabled = isDisabled
    }

    private var selected: AedstSelectOption? {
        options.first { $0.id == selection }
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: AedstSpacing.xxs) {
            AedstLabel(label)
                .accessibilityHidden(true)

            Menu {
                Picker(label, selection: $selection) {
                    ForEach(options) { option in
                        optionLabel(option)
                            .tag(String?.some(option.id))
                            .selectionDisabled(option.isDisabled)
                    }
                }
                .pickerStyle(.inline)
                .labelsHidden()
            } label: {
                AedstSelectTriggerLabel(
                    title: selected?.title ?? placeholder,
                    isPlaceholder: selected == nil,
                    systemImage: selected?.systemImage,
                    isInvalid: errorMessage != nil,
                    size: size
                )
            }
            #if os(macOS)
            .menuStyle(.borderlessButton)
            .menuIndicator(.hidden)
            #endif
            .aedstDisabled(isDisabled)
            .accessibilityLabel(Text(label))
            .accessibilityValue(Text(selected?.title ?? placeholder))

            if let errorMessage {
                Text(errorMessage)
                    .font(AedstTypography.caption)
                    .foregroundStyle(AedstColor.destructive)
                    .accessibilityLabel(Text(AedstStrings.errorPrefix(errorMessage)))
            }
        }
        .onChange(of: errorMessage) { previous, current in
            if let text = AedstAnnouncementPolicy.announcement(previous: previous, current: current) {
                AedstAnnouncer.post(text)
            }
        }
    }

    @ViewBuilder
    private func optionLabel(_ option: AedstSelectOption) -> some View {
        if let systemImage = option.systemImage {
            Label(option.title, systemImage: systemImage)
        } else {
            Text(option.title)
        }
    }
}

#Preview("AedstSelect") {
    @Previewable @State var fruit: String? = "apple"
    @Previewable @State var empty: String? = nil
    let options = [
        AedstSelectOption(id: "apple", title: "Apple"),
        AedstSelectOption(id: "banana", title: "Banana"),
        AedstSelectOption(id: "grape", title: "Grape", isDisabled: true),
    ]
    VStack(alignment: .leading, spacing: AedstSpacing.lg) {
        AedstSelect("Fruit", options: options, selection: $fruit)
        AedstSelect("Small", options: options, selection: $fruit, size: .sm)
        AedstSelect("Required", options: options, selection: $empty, errorMessage: "Pick one.")
        AedstSelect("Disabled", options: options, selection: $fruit, isDisabled: true)
    }
    .padding()
}

#endif
