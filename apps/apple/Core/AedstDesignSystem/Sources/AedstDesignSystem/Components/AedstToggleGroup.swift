import SwiftUI

// iOS, macOS and visionOS only: tvOS and watchOS are scaffolded package platforms without app targets.
#if os(iOS) || os(macOS) || os(visionOS)

/// One toggle of an `AedstToggleGroup`.
public struct AedstToggleGroupItem<Value: Hashable & Sendable>: Identifiable, Sendable, Equatable {
    public let value: Value
    /// Already localized title; always the accessibility label.
    public let title: String
    public let systemImage: String?
    public let isDisabled: Bool

    public var id: Value { value }

    public init(_ value: Value, title: String, systemImage: String? = nil, isDisabled: Bool = false) {
        self.value = value
        self.title = title
        self.systemImage = systemImage
        self.isDisabled = isDisabled
    }
}

/// Pure selection rules of the toggle group, kept apart from the view so they are unit-tested.
enum AedstToggleGroupLogic {
    /// Single selection: pressing the selected item again clears it.
    static func toggledSingle<Value: Hashable>(_ value: Value, current: Value?) -> Value? {
        current == value ? nil : value
    }

    /// Multiple selection: pressing an item adds or removes it.
    static func toggledMultiple<Value: Hashable>(_ value: Value, current: Set<Value>) -> Set<Value> {
        var next = current
        if next.contains(value) {
            next.remove(value)
        } else {
            next.insert(value)
        }
        return next
    }
}

/// Row of `AedstToggle`s that share a selection, matching shadcn/ui `ToggleGroup`: single (`selection:`, at most
/// one item on) or multiple (`selections:`).
public struct AedstToggleGroup<Value: Hashable & Sendable>: View {
    private let label: String
    private let items: [AedstToggleGroupItem<Value>]
    private let variant: AedstToggleVariant
    private let size: AedstToggleSize
    private let showsTitles: Bool
    private let isSelected: (Value) -> Bool
    private let toggle: (Value) -> Void

    /// Single selection.
    /// - Parameter label: Accessibility label of the whole group ("Text alignment").
    public init(
        _ label: String,
        items: [AedstToggleGroupItem<Value>],
        selection: Binding<Value?>,
        variant: AedstToggleVariant = .default,
        size: AedstToggleSize = .default,
        showsTitles: Bool = true
    ) {
        self.label = label
        self.items = items
        self.variant = variant
        self.size = size
        self.showsTitles = showsTitles
        self.isSelected = { selection.wrappedValue == $0 }
        self.toggle = { selection.wrappedValue = AedstToggleGroupLogic.toggledSingle($0, current: selection.wrappedValue) }
    }

    /// Multiple selection.
    /// - Parameter label: Accessibility label of the whole group ("Text style").
    public init(
        _ label: String,
        items: [AedstToggleGroupItem<Value>],
        selections: Binding<Set<Value>>,
        variant: AedstToggleVariant = .default,
        size: AedstToggleSize = .default,
        showsTitles: Bool = true
    ) {
        self.label = label
        self.items = items
        self.variant = variant
        self.size = size
        self.showsTitles = showsTitles
        self.isSelected = { selections.wrappedValue.contains($0) }
        self.toggle = {
            selections.wrappedValue = AedstToggleGroupLogic.toggledMultiple($0, current: selections.wrappedValue)
        }
    }

    public var body: some View {
        HStack(spacing: AedstSpacing.xxs) {
            ForEach(items) { item in
                AedstToggle(
                    item.title,
                    systemImage: item.systemImage,
                    isOn: binding(for: item.value),
                    variant: variant,
                    size: size,
                    showsTitle: showsTitles,
                    isDisabled: item.isDisabled
                )
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(label))
    }

    private func binding(for value: Value) -> Binding<Bool> {
        Binding(
            get: { isSelected(value) },
            set: { isOn in
                if isOn != isSelected(value) { toggle(value) }
            }
        )
    }
}

#Preview("AedstToggleGroup") {
    @Previewable @State var alignment: String? = "leading"
    @Previewable @State var styles: Set<String> = ["bold"]
    VStack(alignment: .leading, spacing: AedstSpacing.lg) {
        AedstToggleGroup(
            "Text alignment",
            items: [
                AedstToggleGroupItem("leading", title: "Leading", systemImage: "text.alignleft"),
                AedstToggleGroupItem("center", title: "Center", systemImage: "text.aligncenter"),
                AedstToggleGroupItem("trailing", title: "Trailing", systemImage: "text.alignright"),
            ],
            selection: $alignment,
            variant: .outline,
            showsTitles: false
        )
        AedstToggleGroup(
            "Text style",
            items: [
                AedstToggleGroupItem("bold", title: "Bold"),
                AedstToggleGroupItem("italic", title: "Italic"),
                AedstToggleGroupItem("underline", title: "Underline", isDisabled: true),
            ],
            selections: $styles
        )
    }
    .padding()
}

#endif
