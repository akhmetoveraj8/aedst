import SwiftUI

/// shadcn/ui `Card` `size`: `sm` tightens the padding and gaps (16 -> 12 pt) and sets the title one step smaller.
public enum AedstCardSize: Sendable, CaseIterable {
    case `default`
    case sm

    /// Padding and the gap between the card's parts (web `--card-spacing`).
    var spacing: CGFloat {
        switch self {
        case .default: AedstSpacing.lg
        case .sm: AedstSpacing.md
        }
    }

    /// Font of `AedstCardHeader`'s title (web `text-base` / `text-sm`).
    var titleFont: Font {
        switch self {
        case .default: AedstTypography.headline
        case .sm: AedstTypography.body.weight(.semibold)
        }
    }
}

extension EnvironmentValues {
    /// Size of the enclosing `AedstCard`, read by its header.
    @Entry var aedstCardSize: AedstCardSize = .default
}

/// Container view mirroring shadcn/ui `Card` + `CardHeader`/`CardContent`/
/// `CardFooter`. Use the free `content:` initializer for a simple card, or
/// compose `AedstCardHeader`/`AedstCardFooter` inside it for the full
/// header/content/footer layout.
public struct AedstCard<Content: View>: View {
    private let size: AedstCardSize
    private let content: Content

    public init(size: AedstCardSize = .default, @ViewBuilder content: () -> Content) {
        self.size = size
        self.content = content()
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: size.spacing) {
            content
        }
        .padding(size.spacing)
        .environment(\.aedstCardSize, size)
        .background(AedstColor.card)
        .foregroundStyle(AedstColor.cardForeground)
        .clipShape(RoundedRectangle(cornerRadius: AedstRadius.xl, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: AedstRadius.xl, style: .continuous)
                .strokeBorder(AedstColor.border, lineWidth: 1)
        }
    }
}

public struct AedstCardHeader: View {
    private let title: String
    private let subtitle: String?
    @Environment(\.aedstCardSize) private var size

    public init(_ title: String, subtitle: String? = nil) {
        self.title = title
        self.subtitle = subtitle
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: AedstSpacing.xxs) {
            Text(title)
                .font(size.titleFont)
                .accessibilityAddTraits(.isHeader)
            if let subtitle {
                Text(subtitle)
                    .font(AedstTypography.caption)
                    .foregroundStyle(AedstColor.mutedForeground)
            }
        }
    }
}

public struct AedstCardFooter<Content: View>: View {
    private let content: Content

    public init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    public var body: some View {
        HStack {
            content
        }
        .padding(.top, AedstSpacing.xs)
    }
}

#Preview("AedstCard — Light") {
    AedstCard {
        AedstCardHeader("Weekly summary", subtitle: "12 tasks completed")
        Text("You're ahead of schedule this week.") // i18n-ok: preview
            .font(AedstTypography.body)
        AedstCardFooter {
            AedstButton("View details", variant: .secondary, size: .sm) {}
        }
    }
    .padding()
    .preferredColorScheme(.light)
}

#Preview("AedstCard — Small") {
    AedstCard(size: .sm) {
        AedstCardHeader("Weekly summary", subtitle: "12 tasks completed")
        AedstCardFooter {
            AedstButton("View details", variant: .secondary, size: .sm) {}
        }
    }
    .padding()
}

#Preview("AedstCard — Dark") {
    AedstCard {
        AedstCardHeader("Weekly summary", subtitle: "12 tasks completed")
    }
    .padding()
    .preferredColorScheme(.dark)
}
