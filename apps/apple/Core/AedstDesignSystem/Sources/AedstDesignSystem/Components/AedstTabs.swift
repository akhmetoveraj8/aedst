import SwiftUI

// iOS, macOS and visionOS only: tvOS and watchOS are scaffolded package platforms without app targets.
#if os(iOS) || os(macOS) || os(visionOS)

/// Mirrors shadcn/ui `TabsList`'s `variant` prop (`ui-kit.yaml`: default, line).
public enum AedstTabsVariant: Sendable, CaseIterable {
    /// Segmented look: a muted track, the selected tab raised on it.
    case `default`
    /// Text tabs with an underline under the selected one.
    case line
}

/// One tab of `AedstTabs`.
public struct AedstTabItem<Value: Hashable & Sendable>: Identifiable, Sendable, Equatable {
    public let value: Value
    /// Already localized title.
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

/// In-page tabs matching shadcn/ui `Tabs`: a tab list and the panel of the selected tab. For top-level app
/// navigation use the native `TabView`; this is for switching content inside a screen.
public struct AedstTabs<Value: Hashable & Sendable, Content: View>: View {
    private let items: [AedstTabItem<Value>]
    @Binding private var selection: Value
    private let variant: AedstTabsVariant
    private let content: (Value) -> Content

    /// - Parameter content: Panel for the selected tab.
    public init(
        items: [AedstTabItem<Value>],
        selection: Binding<Value>,
        variant: AedstTabsVariant = .default,
        @ViewBuilder content: @escaping (Value) -> Content
    ) {
        self.items = items
        self._selection = selection
        self.variant = variant
        self.content = content
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: AedstSpacing.md) {
            tabList
            content(selection)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var tabList: some View {
        ScrollView(.horizontal) {
            HStack(spacing: variant == .line ? AedstSpacing.xs : AedstSpacing.none) {
                ForEach(items) { item in
                    tab(item)
                }
            }
            .padding(variant == .default ? AedstSpacing.xxs : AedstSpacing.none)
            .background(variant == .default ? AedstColor.muted : Color.clear)
            .clipShape(RoundedRectangle(cornerRadius: AedstRadius.lg, style: .continuous))
        }
        .scrollIndicators(.hidden)
        .accessibilityElement(children: .contain)
        .accessibilityAddTraits(.isTabBar)
    }

    private func tab(_ item: AedstTabItem<Value>) -> some View {
        let isSelected = item.value == selection
        return Button {
            selection = item.value
        } label: {
            HStack(spacing: AedstSpacing.xs) {
                if let systemImage = item.systemImage {
                    Image(systemName: systemImage)
                        .accessibilityHidden(true)
                }
                Text(item.title)
            }
            .font(AedstTypography.body.weight(.medium))
            .foregroundStyle(
                AedstDisabledStyle.foreground(
                    isSelected ? AedstColor.foreground : AedstColor.mutedForeground,
                    isDisabled: item.isDisabled
                )
            )
            .padding(.horizontal, AedstSpacing.md)
            .padding(.vertical, AedstSpacing.xs)
            .background(variant == .default && isSelected ? AedstColor.background : Color.clear)
            .clipShape(RoundedRectangle(cornerRadius: AedstRadius.md, style: .continuous))
            .overlay(alignment: .bottom) {
                if variant == .line, isSelected {
                    Capsule()
                        .fill(AedstColor.foreground)
                        .frame(height: AedstSpacing.xxs)
                }
            }
            .aedstHitTarget()
        }
        .buttonStyle(.plain)
        .aedstDisabled(item.isDisabled)
        .aedstAnimation(.easeInOut(duration: AedstMotion.durationFast), value: isSelected)
        .accessibilityAddTraits(isSelected ? [.isButton, .isSelected] : .isButton)
    }
}

#Preview("AedstTabs") {
    @Previewable @State var tab = "account"
    @Previewable @State var lineTab = "overview"
    VStack(alignment: .leading, spacing: AedstSpacing.xxl) {
        AedstTabs(
            items: [
                AedstTabItem("account", title: "Account"),
                AedstTabItem("password", title: "Password"),
                AedstTabItem("billing", title: "Billing", isDisabled: true),
            ],
            selection: $tab
        ) { value in
            Text(verbatim: "Panel: \(value)")
        }
        AedstTabs(
            items: [
                AedstTabItem("overview", title: "Overview", systemImage: "chart.bar"),
                AedstTabItem("activity", title: "Activity", systemImage: "clock"),
            ],
            selection: $lineTab,
            variant: .line
        ) { value in
            Text(verbatim: "Panel: \(value)")
        }
    }
    .padding()
}

#endif
