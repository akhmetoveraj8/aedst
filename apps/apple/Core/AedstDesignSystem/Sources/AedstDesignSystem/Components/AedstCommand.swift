import SwiftUI

// iOS, macOS and visionOS only: tvOS and watchOS are scaffolded package platforms without app targets.
#if os(iOS) || os(macOS) || os(visionOS)

/// One runnable entry of `AedstCommand` (shadcn/ui `CommandItem`).
public struct AedstCommandItem: Identifiable {
    public let id: String
    let title: String
    let systemImage: String?
    let shortcut: String?
    let keywords: [String]
    let isDisabled: Bool
    let action: () -> Void

    /// - Parameters:
    ///   - title: Already localized title; the search matches it.
    ///   - id: Stable identity; defaults to the title.
    ///   - shortcut: Key hint shown at the trailing edge, already formatted (for example "⌘K"). Display only.
    ///   - keywords: Extra words the search matches (synonyms, the untranslated name).
    public init(
        _ title: String,
        id: String? = nil,
        systemImage: String? = nil,
        shortcut: String? = nil,
        keywords: [String] = [],
        isDisabled: Bool = false,
        action: @escaping () -> Void
    ) {
        self.id = id ?? title
        self.title = title
        self.systemImage = systemImage
        self.shortcut = shortcut
        self.keywords = keywords
        self.isDisabled = isDisabled
        self.action = action
    }
}

/// A run of entries under an optional heading (shadcn/ui `CommandGroup`).
public struct AedstCommandGroup: Identifiable {
    public let id: String
    let heading: String?
    let items: [AedstCommandItem]

    /// - Parameter id: Stable identity; defaults to the heading.
    public init(_ heading: String? = nil, id: String? = nil, items: [AedstCommandItem]) {
        self.id = id ?? heading ?? ""
        self.heading = heading
        self.items = items
    }
}

/// Searchable command list matching shadcn/ui `Command` (`CommandInput`, `CommandList`, `CommandGroup`,
/// `CommandItem`, `CommandEmpty`). Show it inline, or as a palette with `aedstCommandDialog`.
///
/// Keyboard: typing filters, Up/Down move the highlight, Return runs the highlighted entry. Each row is also
/// an ordinary button for touch, pointer and VoiceOver.
public struct AedstCommand: View {
    private let groups: [AedstCommandGroup]
    private let placeholder: String
    private let emptyText: String
    private let onRun: () -> Void

    @State private var query = ""
    @State private var highlightedID: String?
    @FocusState private var isSearchFocused: Bool

    /// - Parameters:
    ///   - placeholder: Search prompt; `nil` uses the kit's "Search".
    ///   - emptyText: Shown when nothing matches; `nil` uses the kit's "No results".
    ///   - onRun: Called after any entry ran (a palette closes itself here).
    public init(
        groups: [AedstCommandGroup],
        placeholder: String? = nil,
        emptyText: String? = nil,
        onRun: @escaping () -> Void = {}
    ) {
        self.groups = groups
        self.placeholder = placeholder ?? AedstStrings.search
        self.emptyText = emptyText ?? AedstStrings.noResults
        self.onRun = onRun
    }

    /// Groups reduced to the entries whose title or keywords contain `query` (case-, diacritic- and
    /// width-insensitive, locale-aware); groups left empty are dropped. A blank query keeps everything.
    static func filter(_ groups: [AedstCommandGroup], query: String) -> [AedstCommandGroup] {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !needle.isEmpty else { return groups }
        return groups.compactMap { group in
            let items = group.items.filter { item in
                item.title.localizedStandardContains(needle)
                    || item.keywords.contains { $0.localizedStandardContains(needle) }
            }
            return items.isEmpty ? nil : AedstCommandGroup(group.heading, id: group.id, items: items)
        }
    }

    /// The id `offset` steps from `current` in `ids`, clamped to the ends; the first (or last, when moving
    /// up) id when nothing is highlighted yet.
    static func highlight(after current: String?, in ids: [String], offset: Int) -> String? {
        guard !ids.isEmpty else { return nil }
        guard let current, let index = ids.firstIndex(of: current) else {
            return offset >= 0 ? ids.first : ids.last
        }
        return ids[min(max(index + offset, 0), ids.count - 1)]
    }

    private var visibleGroups: [AedstCommandGroup] { Self.filter(groups, query: query) }

    private var runnableIDs: [String] {
        visibleGroups.flatMap(\.items).filter { !$0.isDisabled }.map(\.id)
    }

    public var body: some View {
        VStack(spacing: AedstSpacing.none) {
            searchField
            AedstSeparator()
            results
        }
        .background(AedstColor.popover)
        .foregroundStyle(AedstColor.popoverForeground)
        .clipShape(RoundedRectangle(cornerRadius: AedstRadius.lg, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: AedstRadius.lg, style: .continuous)
                .strokeBorder(AedstColor.border, lineWidth: 1)
        }
        .onChange(of: query) {
            highlightedID = runnableIDs.first
        }
        // The search field takes keyboard focus on open (typing starts at once).
        .onAppear { isSearchFocused = true }
    }

    private var searchField: some View {
        HStack(spacing: AedstSpacing.sm) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(AedstColor.mutedForeground)
                .accessibilityHidden(true)
            TextField(placeholder, text: $query)
                .textFieldStyle(.plain)
                .font(AedstTypography.body)
                .focused($isSearchFocused)
                .autocorrectionDisabled()
                .onSubmit { runHighlighted() }
                .onKeyPress(.downArrow) { moveHighlight(by: 1) }
                .onKeyPress(.upArrow) { moveHighlight(by: -1) }
                .accessibilityLabel(Text(placeholder))
        }
        .padding(.horizontal, AedstSpacing.md)
        .frame(minHeight: AedstHitTarget.minimum)
    }

    private var results: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: AedstSpacing.xxs) {
                    if visibleGroups.isEmpty {
                        Text(emptyText)
                            .font(AedstTypography.body)
                            .foregroundStyle(AedstColor.mutedForeground)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, AedstSpacing.xxl)
                    }
                    ForEach(visibleGroups) { group in
                        if let heading = group.heading {
                            Text(heading)
                                .font(AedstTypography.caption.weight(.medium))
                                .foregroundStyle(AedstColor.mutedForeground)
                                .padding(.horizontal, AedstSpacing.sm)
                                .padding(.top, AedstSpacing.sm)
                                .accessibilityAddTraits(.isHeader)
                        }
                        ForEach(group.items) { item in
                            row(item).id(item.id)
                        }
                    }
                }
                .padding(AedstSpacing.xs)
            }
            .frame(maxHeight: 320)
            .onChange(of: highlightedID) { _, id in
                if let id { proxy.scrollTo(id) }
            }
        }
    }

    private func row(_ item: AedstCommandItem) -> some View {
        Button {
            run(item)
        } label: {
            HStack(spacing: AedstSpacing.sm) {
                if let systemImage = item.systemImage {
                    Image(systemName: systemImage)
                        .foregroundStyle(AedstColor.mutedForeground)
                        .accessibilityHidden(true)
                }
                Text(item.title)
                    .font(AedstTypography.body)
                    .foregroundStyle(AedstDisabledStyle.foreground(AedstColor.foreground, isDisabled: item.isDisabled))
                Spacer(minLength: AedstSpacing.sm)
                if let shortcut = item.shortcut {
                    Text(shortcut)
                        .font(AedstTypography.caption.monospaced())
                        .foregroundStyle(AedstColor.mutedForeground)
                }
            }
            .padding(.horizontal, AedstSpacing.sm)
            .frame(maxWidth: .infinity, alignment: .leading)
            .aedstHitTarget()
            .background(highlightedID == item.id ? AedstColor.accent : Color.clear)
            .clipShape(RoundedRectangle(cornerRadius: AedstRadius.sm, style: .continuous))
            .contentShape(Rectangle())
        }
        // Hover only moves the highlight; touch and click run the row, the arrow keys move the highlight and
        // Return runs it, and the focus ring shows keyboard focus on the row itself.
        .buttonStyle(AedstPressableButtonStyle(cornerRadius: AedstRadius.sm, showsHover: false))
        .aedstDisabled(item.isDisabled)
        .onHover { hovering in
            if hovering, !item.isDisabled { highlightedID = item.id }
        }
        .accessibilityAddTraits(highlightedID == item.id ? .isSelected : [])
    }

    private func moveHighlight(by offset: Int) -> KeyPress.Result {
        highlightedID = Self.highlight(after: highlightedID, in: runnableIDs, offset: offset)
        return .handled
    }

    private func runHighlighted() {
        let items = visibleGroups.flatMap(\.items).filter { !$0.isDisabled }
        guard let item = items.first(where: { $0.id == highlightedID }) ?? items.first else { return }
        run(item)
    }

    private func run(_ item: AedstCommandItem) {
        item.action()
        onRun()
    }
}

extension View {
    /// Presents `AedstCommand` as a palette (shadcn/ui `CommandDialog`): a form-sized sheet that closes after
    /// an entry ran, by Escape or by a swipe. Bind a key equivalent to whatever toggles `isPresented`.
    /// `returnFocus` names the control that opened it (see `AedstFocusReturn`).
    public func aedstCommandDialog(
        isPresented: Binding<Bool>,
        groups: [AedstCommandGroup],
        placeholder: String? = nil,
        emptyText: String? = nil,
        returnFocus: AedstFocusReturn? = nil
    ) -> some View {
        aedstReturnsFocus(whenPresented: isPresented.wrappedValue, to: returnFocus).sheet(isPresented: isPresented) {
            AedstCommand(groups: groups, placeholder: placeholder, emptyText: emptyText) {
                isPresented.wrappedValue = false
            }
            .padding(AedstSpacing.lg)
            .frame(maxHeight: .infinity, alignment: .top)
            #if os(macOS)
            .frame(minWidth: 420, idealWidth: 520)
            #endif
            .presentationSizing(.form)
            .presentationBackground(AedstColor.background)
            .accessibilityElement(children: .contain)
            .accessibilityLabel(Text(AedstStrings.commandPalette))
            // VoiceOver moves into the palette when it opens.
            .aedstAnnounceScreenChange()
        }
    }
}

#Preview("AedstCommand") {
    AedstCommand(groups: [
        AedstCommandGroup("Suggestions", items: [
            AedstCommandItem("Calendar", systemImage: "calendar") {},
            AedstCommandItem("Search tasks", systemImage: "magnifyingglass", keywords: ["find"]) {},
        ]),
        AedstCommandGroup("Settings", items: [
            AedstCommandItem("Profile", systemImage: "person", shortcut: "⌘P") {},
            AedstCommandItem("Billing", systemImage: "creditcard", shortcut: "⌘B", isDisabled: true) {},
        ]),
    ])
    .padding()
}

#endif
