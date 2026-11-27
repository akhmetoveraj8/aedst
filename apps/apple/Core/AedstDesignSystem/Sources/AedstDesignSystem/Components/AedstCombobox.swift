import SwiftUI

// iOS, macOS and visionOS only: tvOS and watchOS are scaffolded package platforms without app targets.
#if os(iOS) || os(macOS) || os(visionOS)

/// Searchable single-choice picker matching shadcn/ui `Combobox`: the same trigger as `AedstSelect`, opening a
/// popover with a search field (`ComboboxInput`), the filtered options (`ComboboxList` / `ComboboxItem`), an
/// empty state (`ComboboxEmpty`) and an optional clear action (`ComboboxClear`).
///
/// SwiftUI has no native combo box on iOS, so the list is built here; it is shown in the system popover, which
/// stays an anchored bubble on iPhone as well. Use `AedstSelect` when the list is short enough not to search.
public struct AedstCombobox: View {
    private let label: String
    private let options: [AedstSelectOption]
    @Binding private var selection: String?
    private let placeholder: String
    private let searchPlaceholder: String
    private let emptyText: String
    private let allowsClear: Bool
    private let isDisabled: Bool

    @State private var isPresented = false
    @State private var query = ""
    @FocusState private var isSearchFocused: Bool

    /// - Parameters:
    ///   - label: Already localized field label, shown above the control and read by VoiceOver.
    ///   - options: Choices, in display order.
    ///   - selection: `id` of the chosen option, `nil` while nothing is chosen.
    ///   - placeholder: Shown while nothing is chosen; `nil` uses the kit's "Select an option".
    ///   - searchPlaceholder: Prompt of the search field; `nil` uses the kit's "Search".
    ///   - emptyText: Shown when nothing matches; `nil` uses the kit's "No results".
    ///   - allowsClear: Adds a "Clear" row that resets the selection to `nil`.
    public init(
        _ label: String,
        options: [AedstSelectOption],
        selection: Binding<String?>,
        placeholder: String? = nil,
        searchPlaceholder: String? = nil,
        emptyText: String? = nil,
        allowsClear: Bool = false,
        isDisabled: Bool = false
    ) {
        self.label = label
        self.options = options
        self._selection = selection
        self.placeholder = placeholder ?? AedstStrings.selectOption
        self.searchPlaceholder = searchPlaceholder ?? AedstStrings.search
        self.emptyText = emptyText ?? AedstStrings.noResults
        self.allowsClear = allowsClear
        self.isDisabled = isDisabled
    }

    /// Options whose title contains `query` (case-, diacritic- and width-insensitive, locale-aware), in their
    /// original order. A blank query keeps everything.
    static func filter(_ options: [AedstSelectOption], query: String) -> [AedstSelectOption] {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !needle.isEmpty else { return options }
        return options.filter { $0.title.localizedStandardContains(needle) }
    }

    private var selected: AedstSelectOption? {
        options.first { $0.id == selection }
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: AedstSpacing.xxs) {
            AedstLabel(label)
                .accessibilityHidden(true)

            Button {
                query = ""
                isPresented = true
            } label: {
                AedstSelectTriggerLabel(
                    title: selected?.title ?? placeholder,
                    isPlaceholder: selected == nil,
                    systemImage: selected?.systemImage,
                    isInvalid: false
                )
            }
            .buttonStyle(.plain)
            .aedstDisabled(isDisabled)
            .accessibilityLabel(Text(label))
            .accessibilityValue(Text(selected?.title ?? placeholder))
            .popover(isPresented: $isPresented, attachmentAnchor: .rect(.bounds), arrowEdge: Edge.top) {
                AedstPopoverSurface(inset: AedstSpacing.none) {
                    list
                }
            }
        }
    }

    private var list: some View {
        let matches = Self.filter(options, query: query)
        return VStack(spacing: AedstSpacing.none) {
            HStack(spacing: AedstSpacing.sm) {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(AedstColor.mutedForeground)
                    .accessibilityHidden(true)
                TextField(searchPlaceholder, text: $query)
                    .textFieldStyle(.plain)
                    .font(AedstTypography.body)
                    .focused($isSearchFocused)
                    .autocorrectionDisabled()
                    .onSubmit {
                        if let first = matches.first(where: { !$0.isDisabled }) { choose(first.id) }
                    }
                    .accessibilityLabel(Text(searchPlaceholder))
            }
            .padding(.horizontal, AedstSpacing.md)
            .frame(minHeight: AedstHitTarget.minimum)

            AedstSeparator()

            ScrollView {
                LazyVStack(alignment: .leading, spacing: AedstSpacing.xxs) {
                    if matches.isEmpty {
                        Text(emptyText)
                            .font(AedstTypography.body)
                            .foregroundStyle(AedstColor.mutedForeground)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, AedstSpacing.lg)
                    }
                    ForEach(matches) { option in
                        row(option)
                    }
                    if allowsClear, selection != nil {
                        AedstSeparator()
                        AedstButton(AedstStrings.clear, systemImage: "xmark", variant: .ghost, size: .sm) {
                            choose(nil)
                        }
                    }
                }
                .padding(AedstSpacing.xs)
            }
            .frame(maxHeight: 280)
        }
        .frame(minWidth: 240, idealWidth: 280)
        .onAppear { isSearchFocused = true }
    }

    private func row(_ option: AedstSelectOption) -> some View {
        let isSelected = option.id == selection
        return Button {
            choose(option.id)
        } label: {
            HStack(spacing: AedstSpacing.sm) {
                if let systemImage = option.systemImage {
                    Image(systemName: systemImage)
                        .foregroundStyle(AedstColor.mutedForeground)
                        .accessibilityHidden(true)
                }
                Text(option.title)
                    .font(AedstTypography.body)
                    .foregroundStyle(AedstDisabledStyle.foreground(AedstColor.foreground, isDisabled: option.isDisabled))
                Spacer(minLength: AedstSpacing.sm)
                if isSelected {
                    Image(systemName: "checkmark")
                        .font(AedstTypography.caption.weight(.semibold))
                        .accessibilityHidden(true)
                }
            }
            .padding(.horizontal, AedstSpacing.sm)
            .frame(maxWidth: .infinity, alignment: .leading)
            .aedstHitTarget()
            .background(isSelected ? AedstColor.accent : Color.clear)
            .clipShape(RoundedRectangle(cornerRadius: AedstRadius.sm, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .aedstDisabled(option.isDisabled)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    private func choose(_ id: String?) {
        selection = id
        isPresented = false
    }
}

#Preview("AedstCombobox") {
    @Previewable @State var framework: String? = "swiftui"
    let options = [
        AedstSelectOption(id: "swiftui", title: "SwiftUI"),
        AedstSelectOption(id: "compose", title: "Jetpack Compose"),
        AedstSelectOption(id: "react", title: "React"),
        AedstSelectOption(id: "slint", title: "Slint", isDisabled: true),
    ]
    AedstCombobox("Framework", options: options, selection: $framework, allowsClear: true)
        .padding()
}

#endif
