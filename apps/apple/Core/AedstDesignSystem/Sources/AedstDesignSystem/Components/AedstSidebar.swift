import SwiftUI

// iOS, macOS and visionOS only: tvOS and watchOS are scaffolded package platforms without app targets.
#if os(iOS) || os(macOS) || os(visionOS)

/// Mirrors shadcn/ui `SidebarMenuButton`'s `variant` prop (`ui-kit.yaml`: default, outline).
public enum AedstSidebarMenuButtonVariant: Sendable, CaseIterable {
    /// No chrome until active or hovered.
    case `default`
    /// Background with a border.
    case outline
}

/// Mirrors shadcn/ui `SidebarMenuButton`'s `size` prop (`ui-kit.yaml`: default, sm, lg).
public enum AedstSidebarMenuButtonSize: Sendable, CaseIterable {
    case `default`
    case sm
    case lg

    /// Height of the drawn row; the tappable area is never smaller than 44 pt on touch platforms.
    var minHeight: CGFloat {
        switch self {
        case .sm: 28
        case .default: 32
        case .lg: 48
        }
    }

    var font: Font {
        switch self {
        case .sm: AedstTypography.caption
        case .default, .lg: AedstTypography.body
        }
    }
}

/// App sidebar matching shadcn/ui `Sidebar`: a header, a scrolling body of `AedstSidebarGroup`s and a footer
/// on the `sidebar` colour tokens. Use it as the `sidebar:` column of a `NavigationSplitView` (the system
/// then provides collapsing, the drag-to-resize edge and, on iPhone, the push navigation), or stand-alone.
public struct AedstSidebar<Header: View, Content: View, Footer: View>: View {
    private let header: Header
    private let content: Content
    private let footer: Footer

    /// - Parameters:
    ///   - header: Pinned above the scrolling body (app name, workspace switcher, search).
    ///   - content: `AedstSidebarGroup`s; scrolls.
    ///   - footer: Pinned below the scrolling body (account row).
    public init(
        @ViewBuilder header: () -> Header,
        @ViewBuilder content: () -> Content,
        @ViewBuilder footer: () -> Footer
    ) {
        self.header = header()
        self.content = content()
        self.footer = footer()
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: AedstSpacing.none) {
            header
                .padding(AedstSpacing.sm)
            ScrollView {
                VStack(alignment: .leading, spacing: AedstSpacing.sm) {
                    content
                }
                .padding(AedstSpacing.sm)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .scrollBounceBehavior(.basedOnSize)
            footer
                .padding(AedstSpacing.sm)
        }
        .foregroundStyle(AedstColor.sidebarForeground)
        .background(AedstColor.sidebar)
        #if os(macOS)
        // In a NavigationSplitView the user can drag the column edge on the Mac; keep it within sensible widths
        // (no effect outside a split view).
        .navigationSplitViewColumnWidth(min: 200, ideal: 240, max: 320)
        #endif
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(AedstStrings.sidebar))
    }
}

extension AedstSidebar where Header == EmptyView, Footer == EmptyView {
    /// A sidebar with only a scrolling body.
    public init(@ViewBuilder content: () -> Content) {
        self.init(header: { EmptyView() }, content: content, footer: { EmptyView() })
    }
}

/// A titled section of an `AedstSidebar` (shadcn `SidebarGroup` + `SidebarGroupLabel` + `SidebarMenu`).
public struct AedstSidebarGroup<Content: View>: View {
    private let title: String?
    private let content: Content

    /// - Parameters:
    ///   - title: Already localized section title; `nil` for an untitled group.
    ///   - content: `AedstSidebarMenuButton`s.
    public init(_ title: String? = nil, @ViewBuilder content: () -> Content) {
        self.title = title
        self.content = content()
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: AedstSpacing.xxs) {
            if let title {
                Text(title)
                    .font(AedstTypography.caption.weight(.medium))
                    .foregroundStyle(AedstColor.sidebarForeground.opacity(0.7))
                    .padding(.horizontal, AedstSpacing.sm)
                    .padding(.vertical, AedstSpacing.xs)
                    .accessibilityAddTraits(.isHeader)
            }
            content
        }
    }
}

/// A navigation row of an `AedstSidebar` (shadcn `SidebarMenuButton`, with an optional `SidebarMenuBadge`).
public struct AedstSidebarMenuButton: View {
    private let title: String
    private let systemImage: String?
    private let badge: String?
    private let isActive: Bool
    private let variant: AedstSidebarMenuButtonVariant
    private let size: AedstSidebarMenuButtonSize
    private let action: () -> Void
    @State private var isHovered = false

    /// - Parameters:
    ///   - title: Already localized title.
    ///   - systemImage: SF Symbol shown before the title (decorative).
    ///   - badge: Short trailing text such as an unread count, already formatted.
    ///   - isActive: Marks the row of the current destination.
    public init(
        _ title: String,
        systemImage: String? = nil,
        badge: String? = nil,
        isActive: Bool = false,
        variant: AedstSidebarMenuButtonVariant = .default,
        size: AedstSidebarMenuButtonSize = .default,
        action: @escaping () -> Void
    ) {
        self.title = title
        self.systemImage = systemImage
        self.badge = badge
        self.isActive = isActive
        self.variant = variant
        self.size = size
        self.action = action
    }

    public var body: some View {
        Button(action: action) {
            row.aedstHitTarget()
        }
        .buttonStyle(.plain)
        #if os(macOS)
        // Pointer feedback; touch platforms show the pressed state of the button instead.
        .onHover { isHovered = $0 }
        #endif
        .accessibilityLabel(Text(title))
        .accessibilityValue(Text(badge ?? ""))
        .accessibilityAddTraits(isActive ? .isSelected : [])
    }

    private var isHighlighted: Bool { isActive || isHovered }

    private var row: some View {
        HStack(spacing: AedstSpacing.sm) {
            if let systemImage {
                Image(systemName: systemImage)
                    .accessibilityHidden(true)
            }
            Text(title)
                .lineLimit(1)
            Spacer(minLength: AedstSpacing.none)
            if let badge {
                Text(badge)
                    .font(AedstTypography.caption.weight(.medium))
                    .monospacedDigit()
            }
        }
        .font(size.font.weight(isActive ? .medium : .regular))
        .foregroundStyle(isHighlighted ? AedstColor.sidebarAccentForeground : AedstColor.sidebarForeground)
        .padding(.horizontal, AedstSpacing.sm)
        .frame(maxWidth: .infinity, minHeight: size.minHeight, alignment: .leading)
        .background(background)
        .clipShape(RoundedRectangle(cornerRadius: AedstRadius.md, style: .continuous))
        .overlay {
            if variant == .outline {
                RoundedRectangle(cornerRadius: AedstRadius.md, style: .continuous)
                    .strokeBorder(isHighlighted ? AedstColor.sidebarAccent : AedstColor.sidebarBorder, lineWidth: 1)
            }
        }
    }

    private var background: Color {
        if isHighlighted { return AedstColor.sidebarAccent }
        return variant == .outline ? AedstColor.background : .clear
    }
}

/// Button that shows or hides the sidebar (shadcn `SidebarTrigger`). Bind it to the split view's visibility,
/// e.g. `columnVisibility == .all`. On macOS a `NavigationSplitView` already adds this button to the toolbar,
/// so the trigger is mostly for iPad layouts and custom containers.
public struct AedstSidebarTrigger: View {
    @Binding private var isOpen: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// - Parameter isOpen: Whether the sidebar is shown.
    public init(isOpen: Binding<Bool>) {
        self._isOpen = isOpen
    }

    public var body: some View {
        AedstIconButton(systemImage: "sidebar.leading", accessibilityLabel: AedstStrings.toggleSidebar, size: .iconSm) {
            withAnimation(reduceMotion ? nil : .easeInOut(duration: AedstMotion.durationNormal)) {
                isOpen.toggle()
            }
        }
        .accessibilityValue(Text(isOpen ? AedstStrings.expanded : AedstStrings.collapsed))
    }
}

#Preview("AedstSidebar") {
    @Previewable @State var selected = "inbox"
    @Previewable @State var isOpen = true
    HStack(spacing: AedstSpacing.none) {
        if isOpen {
            AedstSidebar {
                Text(verbatim: "AEDST").font(AedstTypography.headline)
            } content: {
                AedstSidebarGroup("Workspace") {
                    AedstSidebarMenuButton("Inbox", systemImage: "tray", badge: "12", isActive: selected == "inbox") {
                        selected = "inbox"
                    }
                    AedstSidebarMenuButton("Tasks", systemImage: "checklist", isActive: selected == "tasks") {
                        selected = "tasks"
                    }
                    AedstSidebarMenuButton("Settings", systemImage: "gear", variant: .outline, size: .lg) {}
                    AedstSidebarMenuButton("Archive", systemImage: "archivebox", size: .sm) {}
                }
            } footer: {
                Text(verbatim: "ada@example.com").font(AedstTypography.caption)
            }
            .frame(width: 240)
            AedstSeparator(.vertical)
        }
        AedstSidebarTrigger(isOpen: $isOpen)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .padding()
    }
}

#endif
