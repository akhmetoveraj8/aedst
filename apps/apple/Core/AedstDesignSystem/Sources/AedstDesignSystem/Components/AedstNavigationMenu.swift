import SwiftUI

// iOS, macOS and visionOS only: tvOS and watchOS are scaffolded package platforms without app targets.
#if os(iOS) || os(macOS) || os(visionOS)

/// A destination inside a navigation menu panel (shadcn/ui `NavigationMenuLink`).
public struct AedstNavigationMenuLink: Identifiable {
    public let id: String
    let title: String
    let description: String?
    let systemImage: String?
    let action: () -> Void

    /// - Parameters:
    ///   - title: Already localized title.
    ///   - id: Stable identity; defaults to the title.
    ///   - description: Optional line under the title.
    ///   - action: Navigates (push a route on the caller's `Router`).
    public init(
        _ title: String,
        id: String? = nil,
        description: String? = nil,
        systemImage: String? = nil,
        action: @escaping () -> Void
    ) {
        self.id = id ?? title
        self.title = title
        self.description = description
        self.systemImage = systemImage
        self.action = action
    }
}

/// A top-level entry of `AedstNavigationMenu` (shadcn/ui `NavigationMenuItem`): either a direct link or a
/// trigger that opens a panel of links (`NavigationMenuTrigger` + `NavigationMenuContent`).
public struct AedstNavigationMenuItem: Identifiable {
    enum Content {
        case link(() -> Void)
        case panel([AedstNavigationMenuLink])
    }

    public let id: String
    let title: String
    let isCurrent: Bool
    let content: Content

    /// A direct link. `isCurrent` marks the section the user is in.
    public static func link(
        _ title: String,
        id: String? = nil,
        isCurrent: Bool = false,
        action: @escaping () -> Void
    ) -> AedstNavigationMenuItem {
        AedstNavigationMenuItem(id: id ?? title, title: title, isCurrent: isCurrent, content: .link(action))
    }

    /// A trigger that opens a panel of links.
    public static func panel(
        _ title: String,
        id: String? = nil,
        isCurrent: Bool = false,
        links: [AedstNavigationMenuLink]
    ) -> AedstNavigationMenuItem {
        AedstNavigationMenuItem(id: id ?? title, title: title, isCurrent: isCurrent, content: .panel(links))
    }
}

/// Horizontal site-style navigation matching shadcn/ui `NavigationMenu`: a row of links and triggers; a
/// trigger opens a panel of titled links with descriptions.
///
/// The panel is the system popover anchored to its trigger on every platform (an anchored bubble on iPhone
/// too), opened by a tap or click: there is no hover-to-open, so touch, pointer and keyboard behave the same.
/// The row scrolls horizontally when it does not fit (large Dynamic Type, narrow windows). For the app's
/// primary navigation use the platform containers (`TabView`, `NavigationSplitView`) instead.
public struct AedstNavigationMenu: View {
    private let items: [AedstNavigationMenuItem]
    @State private var openItemID: String?

    /// - Parameter items: Entries in reading order (the row mirrors itself in right-to-left layouts).
    public init(items: [AedstNavigationMenuItem]) {
        self.items = items
    }

    public var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: AedstSpacing.xxs) {
                ForEach(items) { item in
                    entry(item)
                }
            }
        }
        .scrollBounceBehavior(.basedOnSize, axes: .horizontal)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(AedstStrings.menu))
    }

    @ViewBuilder
    private func entry(_ item: AedstNavigationMenuItem) -> some View {
        switch item.content {
        case .link(let action):
            Button(action: action) {
                triggerLabel(item, showsChevron: false, isOpen: false)
            }
            .buttonStyle(.plain)
            .accessibilityAddTraits(item.isCurrent ? [.isLink, .isSelected] : .isLink)
        case .panel(let links):
            let isOpen = openItemID == item.id
            Button {
                openItemID = isOpen ? nil : item.id
            } label: {
                triggerLabel(item, showsChevron: true, isOpen: isOpen)
            }
            .buttonStyle(.plain)
            .accessibilityAddTraits(item.isCurrent ? .isSelected : [])
            .accessibilityValue(Text(isOpen ? AedstStrings.expanded : AedstStrings.collapsed))
            .popover(isPresented: isPresented(item.id), attachmentAnchor: .rect(.bounds), arrowEdge: Edge.top) {
                AedstPopoverSurface(inset: AedstSpacing.xs) {
                    panel(links)
                }
            }
        }
    }

    private func isPresented(_ id: String) -> Binding<Bool> {
        Binding(
            get: { openItemID == id },
            set: { presented in
                if presented {
                    openItemID = id
                } else if openItemID == id {
                    openItemID = nil
                }
            }
        )
    }

    private func triggerLabel(_ item: AedstNavigationMenuItem, showsChevron: Bool, isOpen: Bool) -> some View {
        HStack(spacing: AedstSpacing.xs) {
            Text(item.title)
            if showsChevron {
                Image(systemName: "chevron.down")
                    .font(AedstTypography.caption)
                    .rotationEffect(.degrees(isOpen ? 180 : 0))
                    .aedstAnimation(.easeInOut(duration: AedstMotion.durationNormal), value: isOpen)
                    .accessibilityHidden(true)
            }
        }
        .font(AedstTypography.body.weight(.medium))
        .foregroundStyle(AedstColor.foreground)
        .padding(.horizontal, AedstSpacing.md)
        .padding(.vertical, AedstSpacing.xs)
        .background(item.isCurrent || isOpen ? AedstColor.accent : Color.clear)
        .clipShape(RoundedRectangle(cornerRadius: AedstRadius.md, style: .continuous))
        .aedstHitTarget()
    }

    private func panel(_ links: [AedstNavigationMenuLink]) -> some View {
        VStack(alignment: .leading, spacing: AedstSpacing.xxs) {
            ForEach(links) { link in
                Button {
                    openItemID = nil
                    link.action()
                } label: {
                    HStack(alignment: .top, spacing: AedstSpacing.sm) {
                        if let systemImage = link.systemImage {
                            Image(systemName: systemImage)
                                .foregroundStyle(AedstColor.mutedForeground)
                                .accessibilityHidden(true)
                        }
                        VStack(alignment: .leading, spacing: AedstSpacing.xxs) {
                            Text(link.title)
                                .font(AedstTypography.body.weight(.medium))
                            if let description = link.description {
                                Text(description)
                                    .font(AedstTypography.caption)
                                    .foregroundStyle(AedstColor.mutedForeground)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }
                    }
                    .padding(AedstSpacing.sm)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .aedstHitTarget()
                }
                .buttonStyle(.plain)
                .accessibilityElement(children: .combine)
                .accessibilityAddTraits(.isLink)
            }
        }
        .frame(minWidth: 240, maxWidth: 320)
    }
}

#Preview("AedstNavigationMenu") {
    AedstNavigationMenu(items: [
        .panel("Getting started", links: [
            AedstNavigationMenuLink("Introduction", description: "Reusable components built on the tokens.") {},
            AedstNavigationMenuLink("Installation", description: "How to add the package.") {},
        ]),
        .link("Documentation", isCurrent: true) {},
        .link("Changelog") {},
    ])
    .padding()
}

#endif
