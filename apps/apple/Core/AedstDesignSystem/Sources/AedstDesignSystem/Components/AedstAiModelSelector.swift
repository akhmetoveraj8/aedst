import SwiftUI

// iOS, macOS and visionOS only: tvOS and watchOS are scaffolded package platforms without app targets.
#if os(iOS) || os(macOS) || os(visionOS)

/// One model in `AedstAiModelSelector` (web `AiModelSelectorItem`).
public struct AedstAiModelSelectorItem: Identifiable, Hashable, Sendable {
    public let id: String
    /// Visible name (web `AiModelSelectorName`).
    public let name: String
    /// Provider logos as SF Symbol names (web `AiModelSelectorLogo`); they
    /// overlap in the trigger (`AiModelSelectorLogoGroup`); the menu shows names only.
    public let logos: [String]

    public init(id: String, name: String, logos: [String] = []) {
        self.id = id
        self.name = name
        self.logos = logos
    }
}

/// A group of models under an optional heading, e.g. the provider (web `AiModelSelectorGroup` `heading`).
public struct AedstAiModelSelectorGroup: Identifiable, Hashable, Sendable {
    public let id: String
    public let heading: String?
    public let models: [AedstAiModelSelectorItem]

    public init(id: String? = nil, heading: String? = nil, models: [AedstAiModelSelectorItem]) {
        self.id = id ?? heading ?? models.map(\.id).joined(separator: ",")
        self.heading = heading
        self.models = models
    }
}

/// Picks the model (or effort) the agent runs with, matching shadcn AI Elements `Model Selector`: the kit's
/// `AedstDropdownMenu` (native `Menu`) of radio-like entries, one section per group, behind a compact trigger
/// that fits in `AedstAiPromptInputTools`. Picking a model closes the menu. A long, searchable list belongs in
/// `AedstCommand`, as on web.
///
/// VoiceOver reads the trigger as "`label`, `selected model`, button"; the menu marks the selected model.
public struct AedstAiModelSelector: View {
    @Binding private var selection: String
    private let groups: [AedstAiModelSelectorGroup]
    private let label: String

    /// - Parameters:
    ///   - selection: The selected model's `id` (web radio group `value`).
    ///   - groups: Sections of the menu, separated by a divider (web `AiModelSelectorSeparator`).
    ///   - label: Accessible name of the trigger, e.g. "Model".
    public init(selection: Binding<String>, groups: [AedstAiModelSelectorGroup], label: String) {
        self._selection = selection
        self.groups = groups
        self.label = label
    }

    public var body: some View {
        let selected = Self.model(withID: selection, in: groups)
        AedstDropdownMenu(items: Self.menuItems(groups: groups, selection: selection) { selection = $0 }) {
            AedstAiModelSelectorTrigger(name: selected?.name ?? "", logos: selected?.logos ?? [])
        }
        .accessibilityLabel(Text(label))
        .accessibilityValue(Text(selected?.name ?? ""))
    }

    /// The model with `id`, if any group holds it.
    static func model(withID id: String, in groups: [AedstAiModelSelectorGroup]) -> AedstAiModelSelectorItem? {
        groups.lazy.flatMap(\.models).first { $0.id == id }
    }

    /// Menu entries: one section per group, a check mark on the selected model.
    static func menuItems(
        groups: [AedstAiModelSelectorGroup],
        selection: String,
        select: @escaping (String) -> Void
    ) -> [AedstMenuItem] {
        groups.map { group -> AedstMenuItem in
            .section(group.heading ?? "", items: group.models.map { model -> AedstMenuItem in
                .checkbox(model.name, isOn: model.id == selection) { select(model.id) }
            })
        }
    }
}

/// The trigger (`AiModelSelectorTrigger`): the current model's logos and name with a chevron, styled as a small
/// ghost input-group button.
public struct AedstAiModelSelectorTrigger: View {
    private let name: String
    private let logos: [String]

    public init(name: String, logos: [String] = []) {
        self.name = name
        self.logos = logos
    }

    public var body: some View {
        HStack(spacing: AedstSpacing.xs) {
            if !logos.isEmpty {
                AedstAiModelSelectorLogoGroup(logos: logos)
            }
            AedstAiModelSelectorName(name)
            Image(systemName: "chevron.down")
                .font(AedstTypography.caption)
                .foregroundStyle(AedstColor.mutedForeground)
                .accessibilityHidden(true)
        }
        .font(AedstTypography.caption.weight(.medium))
        .foregroundStyle(AedstColor.foreground)
        .padding(.horizontal, AedstSpacing.sm)
        .aedstScaledMinFrame(minHeight: 32)
        .contentShape(RoundedRectangle(cornerRadius: AedstRadius.md, style: .continuous))
    }
}

/// One provider logo, 16 pt, decorative (`AiModelSelectorLogo`).
public struct AedstAiModelSelectorLogo: View {
    private let systemImage: String

    public init(systemImage: String) {
        self.systemImage = systemImage
    }

    public var body: some View {
        Image(systemName: systemImage)
            .resizable()
            .scaledToFit()
            .aedstScaledFrame(width: AedstSpacing.lg, height: AedstSpacing.lg)
            .accessibilityHidden(true)
    }
}

/// Overlapping row of logos (`AiModelSelectorLogoGroup`), each ringed with the background colour.
public struct AedstAiModelSelectorLogoGroup: View {
    private let logos: [String]

    public init(logos: [String]) {
        self.logos = logos
    }

    public var body: some View {
        HStack(spacing: -AedstSpacing.xs) {
            ForEach(Array(logos.enumerated()), id: \.offset) { _, logo in
                AedstAiModelSelectorLogo(systemImage: logo)
                    .background(AedstColor.background, in: Circle())
                    .overlay { Circle().strokeBorder(AedstColor.background, lineWidth: 1) }
            }
        }
        .accessibilityHidden(true)
    }
}

/// The model name, one line, truncated (`AiModelSelectorName`).
public struct AedstAiModelSelectorName: View {
    private let name: String

    public init(_ name: String) {
        self.name = name
    }

    public var body: some View {
        Text(name)
            .lineLimit(1)
            .truncationMode(.tail)
    }
}

#Preview("AedstAiModelSelector") {
    @Previewable @State var model = "fast"
    AedstAiModelSelector(
        selection: $model,
        groups: [
            AedstAiModelSelectorGroup(heading: "Anthropic", models: [
                AedstAiModelSelectorItem(id: "fast", name: "Fast", logos: ["hare"]),
                AedstAiModelSelectorItem(id: "smart", name: "Smart", logos: ["brain"]),
            ]),
            AedstAiModelSelectorGroup(heading: "Local", models: [
                AedstAiModelSelectorItem(id: "local", name: "On device", logos: ["laptopcomputer"]),
            ]),
        ],
        label: "Model"
    )
    .padding()
}

#endif
