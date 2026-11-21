import SwiftUI

// iOS, macOS and visionOS only: tvOS and watchOS are scaffolded package platforms without app targets.
#if os(iOS) || os(macOS) || os(visionOS)

/// Disclosure matching shadcn/ui `Collapsible`: a trigger row (chevron + label) that shows or hides its content.
/// Hand-built instead of `DisclosureGroup` so the row, the chevron and the motion are the same on iOS and macOS.
///
/// Controlled (`isExpanded:` binding) or uncontrolled (`initiallyExpanded:`). The trigger is one button with the
/// value "Expanded" / "Collapsed" for assistive technologies.
public struct AedstCollapsible<Label: View, Content: View>: View {
    @State private var localExpanded: Bool
    private let externalExpanded: Binding<Bool>?
    private let isDisabled: Bool
    private let label: Label
    private let content: Content

    @Environment(\.layoutDirection) private var layoutDirection

    /// Controlled: the caller owns the open state.
    public init(
        isExpanded: Binding<Bool>,
        isDisabled: Bool = false,
        @ViewBuilder label: () -> Label,
        @ViewBuilder content: () -> Content
    ) {
        self._localExpanded = State(initialValue: isExpanded.wrappedValue)
        self.externalExpanded = isExpanded
        self.isDisabled = isDisabled
        self.label = label()
        self.content = content()
    }

    /// Uncontrolled: the component keeps the open state itself.
    public init(
        initiallyExpanded: Bool = false,
        isDisabled: Bool = false,
        @ViewBuilder label: () -> Label,
        @ViewBuilder content: () -> Content
    ) {
        self._localExpanded = State(initialValue: initiallyExpanded)
        self.externalExpanded = nil
        self.isDisabled = isDisabled
        self.label = label()
        self.content = content()
    }

    private var isExpanded: Bool { externalExpanded?.wrappedValue ?? localExpanded }

    private func toggle() {
        if let externalExpanded {
            externalExpanded.wrappedValue.toggle()
        } else {
            localExpanded.toggle()
        }
    }

    /// The forward chevron already mirrors in right-to-left layouts, so the quarter turn that points it down
    /// has to go the other way there.
    private var chevronAngle: Angle {
        guard isExpanded else { return .zero }
        return .degrees(layoutDirection == .rightToLeft ? -90 : 90)
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: AedstSpacing.none) {
            Button(action: toggle) {
                HStack(spacing: AedstSpacing.sm) {
                    Image(systemName: "chevron.forward")
                        .font(AedstTypography.caption.weight(.semibold))
                        .foregroundStyle(AedstColor.mutedForeground)
                        .rotationEffect(chevronAngle)
                        .accessibilityHidden(true)
                    label
                    Spacer(minLength: AedstSpacing.none)
                }
                .padding(.horizontal, AedstSpacing.sm)
                .frame(maxWidth: .infinity, alignment: .leading)
                .aedstHitTarget()
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(isDisabled)
            .opacity(isDisabled ? 0.5 : 1)
            .accessibilityValue(Text(isExpanded ? AedstStrings.expanded : AedstStrings.collapsed))

            if isExpanded {
                content
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .transition(.opacity)
            }
        }
        .aedstAnimation(.easeInOut(duration: AedstMotion.durationNormal), value: isExpanded)
    }
}

extension AedstCollapsible where Label == Text {
    /// Uncontrolled collapsible with a plain text trigger.
    public init(_ title: String, initiallyExpanded: Bool = false, @ViewBuilder content: () -> Content) {
        self.init(
            initiallyExpanded: initiallyExpanded,
            label: { Text(title).font(AedstTypography.body.weight(.medium)) },
            content: content
        )
    }

    /// Controlled collapsible with a plain text trigger.
    public init(_ title: String, isExpanded: Binding<Bool>, @ViewBuilder content: () -> Content) {
        self.init(
            isExpanded: isExpanded,
            label: { Text(title).font(AedstTypography.body.weight(.medium)) },
            content: content
        )
    }
}

#Preview("AedstCollapsible") {
    @Previewable @State var isExpanded = true
    VStack(alignment: .leading, spacing: AedstSpacing.sm) {
        AedstCollapsible("Starred repositories", isExpanded: $isExpanded) {
            Text("aedst/design-tokens") // i18n-ok: preview
                .font(AedstTypography.body)
                .padding(.horizontal, AedstSpacing.sm)
        }
        AedstCollapsible("Closed by default") {
            Text("Hidden until opened") // i18n-ok: preview
                .padding(.horizontal, AedstSpacing.sm)
        }
    }
    .padding()
}

#endif
