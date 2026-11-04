import SwiftUI

/// Container view mirroring shadcn/ui `Card` + `CardHeader`/`CardContent`/
/// `CardFooter`. Use the free `content:` initializer for a simple card, or
/// compose `AedstCardHeader`/`AedstCardFooter` inside it for the full
/// header/content/footer layout.
public struct AedstCard<Content: View>: View {
    private let content: Content

    public init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: AedstSpacing.sm) {
            content
        }
        .padding(AedstSpacing.lg)
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

    public init(_ title: String, subtitle: String? = nil) {
        self.title = title
        self.subtitle = subtitle
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: AedstSpacing.xxs) {
            Text(title)
                .font(AedstTypography.headline)
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

#Preview("AedstCard — Dark") {
    AedstCard {
        AedstCardHeader("Weekly summary", subtitle: "12 tasks completed")
    }
    .padding()
    .preferredColorScheme(.dark)
}
