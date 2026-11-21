import SwiftUI

// iOS, macOS and visionOS only: tvOS and watchOS are scaffolded package platforms without app targets.
#if os(iOS) || os(macOS) || os(visionOS)

/// Header, scrolling body and stacked footer of a drawer, laid out like shadcn/ui `DrawerContent`
/// (`DrawerHeader` with `DrawerTitle` / `DrawerDescription`, the content, `DrawerFooter`).
private struct AedstDrawerLayout<DrawerContent: View, Footer: View>: View {
    let title: String
    let description: String?
    let drawerContent: DrawerContent
    let footer: Footer

    var body: some View {
        VStack(alignment: .leading, spacing: AedstSpacing.lg) {
            VStack(alignment: .leading, spacing: AedstSpacing.xs) {
                Text(title)
                    .font(AedstTypography.headline)
                    .accessibilityAddTraits(.isHeader)
                if let description {
                    Text(description)
                        .font(AedstTypography.caption)
                        .foregroundStyle(AedstColor.mutedForeground)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            ScrollView {
                drawerContent
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .scrollBounceBehavior(.basedOnSize)

            // Actions stacked full width, as in the web drawer footer.
            VStack(spacing: AedstSpacing.sm) {
                footer
            }
        }
        .padding(AedstSpacing.xxl)
        .foregroundStyle(AedstColor.foreground)
        #if os(macOS)
        // A macOS sheet has no size of its own.
        .frame(minWidth: 360, idealWidth: 440, maxWidth: 560, minHeight: 240)
        #endif
    }
}

/// Bottom drawer matching shadcn/ui `Drawer`: a `ViewModifier` that puts a titled layout with a stacked
/// footer into the kit's sheet (`aedstSheet`), so the grabber, the detents and the swipe-down gesture are the
/// system's and need no Reduce Motion handling of their own.
///
/// - iPhone, iPad: a bottom sheet with a drag indicator, resting at the given detents.
/// - macOS: the platform has no bottom sheet; the same content is shown as a window-modal sheet. Add a
///   closing action to `footer`, because there is nothing to swipe.
///
/// Use `aedstSheet` directly when the content brings its own layout, and `aedstDialog` for a short modal form.
public struct AedstDrawerModifier<DrawerContent: View, Footer: View>: ViewModifier {
    @Binding private var isPresented: Bool
    private let title: String
    private let description: String?
    private let detents: Set<AedstSheetDetent>
    private let drawerContent: DrawerContent
    private let footer: Footer

    /// - Parameters:
    ///   - title: Already localized title; also the drawer's accessibility heading.
    ///   - description: Optional text under the title.
    ///   - detents: Heights the drawer may rest at.
    ///   - content: Body of the drawer; it scrolls when it does not fit.
    ///   - footer: Action buttons, stacked top to bottom, primary action first.
    public init(
        isPresented: Binding<Bool>,
        title: String,
        description: String? = nil,
        detents: Set<AedstSheetDetent> = [.medium, .large],
        @ViewBuilder content: () -> DrawerContent,
        @ViewBuilder footer: () -> Footer
    ) {
        self._isPresented = isPresented
        self.title = title
        self.description = description
        self.detents = detents
        self.drawerContent = content()
        self.footer = footer()
    }

    public func body(content: Content) -> some View {
        content.aedstSheet(isPresented: $isPresented, detents: detents) {
            AedstDrawerLayout(
                title: title,
                description: description,
                drawerContent: drawerContent,
                footer: footer
            )
        }
    }
}

extension View {
    /// Presents a bottom drawer with a title, scrolling content and stacked action buttons.
    public func aedstDrawer<Content: View, Footer: View>(
        isPresented: Binding<Bool>,
        title: String,
        description: String? = nil,
        detents: Set<AedstSheetDetent> = [.medium, .large],
        @ViewBuilder content: @escaping () -> Content,
        @ViewBuilder footer: @escaping () -> Footer
    ) -> some View {
        modifier(
            AedstDrawerModifier(
                isPresented: isPresented,
                title: title,
                description: description,
                detents: detents,
                content: content,
                footer: footer
            )
        )
    }
}

#Preview("AedstDrawer") {
    @Previewable @State var isPresented = true
    AedstButton("Open drawer", variant: .outline, fillsWidth: false) { isPresented = true }
        .aedstDrawer(
            isPresented: $isPresented,
            title: "Move goal",
            description: "Set your daily activity goal.",
            detents: [.medium]
        ) {
            AedstProgressView(value: 0.7, label: "350 kcal")
        } footer: {
            AedstButton("Submit") { isPresented = false }
            AedstButton("Cancel", variant: .outline) { isPresented = false }
        }
        .padding()
}

#endif
