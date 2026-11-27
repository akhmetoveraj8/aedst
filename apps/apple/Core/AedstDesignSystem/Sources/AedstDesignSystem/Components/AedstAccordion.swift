import SwiftUI

// iOS, macOS and visionOS only: tvOS and watchOS are scaffolded package platforms without app targets.
#if os(iOS) || os(macOS) || os(visionOS)

/// One section of an `AedstAccordion`.
public struct AedstAccordionItem<ID: Hashable & Sendable>: Identifiable, Sendable, Equatable {
    public let id: ID
    /// Already localized trigger text.
    public let title: String
    public let isDisabled: Bool

    public init(id: ID, title: String, isDisabled: Bool = false) {
        self.id = id
        self.title = title
        self.isDisabled = isDisabled
    }
}

/// How many sections of an `AedstAccordion` may be open at once (shadcn/ui `multiple`).
public enum AedstAccordionMode: Sendable {
    /// Opening a section closes the others.
    case single
    /// Sections open and close independently.
    case multiple
}

/// Pure open/close rule of the accordion, kept apart from the view so it is unit-tested.
enum AedstAccordionLogic {
    static func toggled<ID: Hashable>(_ id: ID, in expanded: Set<ID>, mode: AedstAccordionMode) -> Set<ID> {
        if expanded.contains(id) {
            var next = expanded
            next.remove(id)
            return next
        }
        switch mode {
        case .single: return [id]
        case .multiple: return expanded.union([id])
        }
    }
}

/// Vertically stacked disclosure sections matching shadcn/ui `Accordion`: a title row with a chevron per item,
/// a separator between items, content built per item id.
public struct AedstAccordion<ID: Hashable & Sendable, Content: View>: View {
    private let items: [AedstAccordionItem<ID>]
    @Binding private var expanded: Set<ID>
    private let mode: AedstAccordionMode
    private let content: (ID) -> Content

    /// - Parameters:
    ///   - expanded: Ids of the open sections.
    ///   - content: Body of a section; built only while the section is open.
    public init(
        items: [AedstAccordionItem<ID>],
        expanded: Binding<Set<ID>>,
        mode: AedstAccordionMode = .single,
        @ViewBuilder content: @escaping (ID) -> Content
    ) {
        self.items = items
        self._expanded = expanded
        self.mode = mode
        self.content = content
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: AedstSpacing.none) {
            ForEach(items) { item in
                let isOpen = expanded.contains(item.id)
                Button {
                    expanded = AedstAccordionLogic.toggled(item.id, in: expanded, mode: mode)
                } label: {
                    HStack(spacing: AedstSpacing.sm) {
                        Text(item.title)
                            .font(AedstTypography.body.weight(.medium))
                            .foregroundStyle(AedstDisabledStyle.foreground(AedstColor.foreground, isDisabled: item.isDisabled))
                            .multilineTextAlignment(.leading)
                        Spacer(minLength: AedstSpacing.sm)
                        Image(systemName: "chevron.down")
                            .font(AedstTypography.caption.weight(.semibold))
                            .foregroundStyle(AedstColor.mutedForeground)
                            .rotationEffect(.degrees(isOpen ? 180 : 0))
                            .accessibilityHidden(true)
                    }
                    .padding(.vertical, AedstSpacing.sm)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .aedstHitTarget()
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .aedstDisabled(item.isDisabled)
                .accessibilityAddTraits(.isHeader)
                .accessibilityValue(Text(isOpen ? AedstStrings.expanded : AedstStrings.collapsed))

                if isOpen {
                    content(item.id)
                        .font(AedstTypography.body)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.bottom, AedstSpacing.md)
                        .transition(.opacity)
                }

                if item.id != items.last?.id {
                    AedstSeparator()
                }
            }
        }
        .aedstAnimation(.easeInOut(duration: AedstMotion.durationNormal), value: expanded)
    }
}

#Preview("AedstAccordion") {
    @Previewable @State var expanded: Set<String> = ["shipping"]
    AedstAccordion(
        items: [
            AedstAccordionItem(id: "shipping", title: "Is shipping free?"),
            AedstAccordionItem(id: "returns", title: "How do returns work?"),
            AedstAccordionItem(id: "gift", title: "Gift cards", isDisabled: true),
        ],
        expanded: $expanded
    ) { id in
        Text(verbatim: "Answer for \(id)")
            .foregroundStyle(AedstColor.mutedForeground)
    }
    .padding()
}

#endif
