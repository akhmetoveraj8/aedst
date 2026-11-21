import SwiftUI

/// Mirrors shadcn/ui `EmptyMedia`'s `variant` prop (`ui-kit.yaml`: default, icon).
public enum AedstEmptyVariant: Sendable, CaseIterable {
    /// The symbol alone, on a transparent background.
    case `default`
    /// The symbol inside a muted rounded tile.
    case icon
}

/// Empty state matching shadcn/ui `Empty`: media, title, description and an optional actions slot, centred in
/// the space it is given. Use it where a list, a search or a table has nothing to show.
public struct AedstEmpty<Actions: View>: View {
    private let title: String
    private let description: String?
    private let systemImage: String?
    private let variant: AedstEmptyVariant
    private let actions: Actions

    /// - Parameters:
    ///   - title: Already localized title.
    ///   - description: Optional explanation or next step.
    ///   - systemImage: SF Symbol shown above the title (decorative).
    ///   - variant: How the symbol is framed.
    ///   - actions: Buttons or links under the description (shadcn/ui `EmptyContent`).
    public init(
        _ title: String,
        description: String? = nil,
        systemImage: String? = nil,
        variant: AedstEmptyVariant = .default,
        @ViewBuilder actions: () -> Actions
    ) {
        self.title = title
        self.description = description
        self.systemImage = systemImage
        self.variant = variant
        self.actions = actions()
    }

    public var body: some View {
        VStack(spacing: AedstSpacing.lg) {
            VStack(spacing: AedstSpacing.sm) {
                if let systemImage {
                    media(systemImage)
                }
                Text(title)
                    .font(AedstTypography.headline)
                    .foregroundStyle(AedstColor.foreground)
                    .accessibilityAddTraits(.isHeader)
                if let description {
                    Text(description)
                        .font(AedstTypography.body)
                        .foregroundStyle(AedstColor.mutedForeground)
                }
            }
            .multilineTextAlignment(.center)
            .accessibilityElement(children: .combine)

            actions
        }
        .padding(AedstSpacing.xxl)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    @ViewBuilder
    private func media(_ systemImage: String) -> some View {
        switch variant {
        case .default:
            Image(systemName: systemImage)
                .font(AedstTypography.largeTitle)
                .foregroundStyle(AedstColor.mutedForeground)
                .accessibilityHidden(true)
        case .icon:
            Image(systemName: systemImage)
                .font(AedstTypography.headline)
                .foregroundStyle(AedstColor.foreground)
                .padding(AedstSpacing.sm)
                .background(AedstColor.muted)
                .clipShape(RoundedRectangle(cornerRadius: AedstRadius.lg, style: .continuous))
                .accessibilityHidden(true)
        }
    }
}

extension AedstEmpty where Actions == EmptyView {
    /// An empty state without actions.
    public init(
        _ title: String,
        description: String? = nil,
        systemImage: String? = nil,
        variant: AedstEmptyVariant = .default
    ) {
        self.init(title, description: description, systemImage: systemImage, variant: variant) {
            EmptyView()
        }
    }
}

#Preview("AedstEmpty") {
    VStack(spacing: AedstSpacing.lg) {
        AedstEmpty("No tasks yet", description: "Create the first task to get started.", systemImage: "tray") {
            AedstButton("New task", systemImage: "plus", fillsWidth: false) {}
        }
        AedstEmpty("Nothing found", systemImage: "magnifyingglass", variant: .icon)
    }
    .padding()
}
