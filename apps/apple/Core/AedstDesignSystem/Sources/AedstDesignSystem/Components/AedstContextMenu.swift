import SwiftUI

// iOS, macOS and visionOS only: tvOS and watchOS are scaffolded package platforms without app targets.
#if os(iOS) || os(macOS) || os(visionOS)

/// Contextual menu matching shadcn/ui `ContextMenu`: a `ViewModifier` over the native `.contextMenu`, fed by
/// the same `AedstMenuItem` model as `AedstDropdownMenu`.
///
/// The platform decides how it opens: touch and hold on iOS and iPadOS (secondary click with a pointer),
/// secondary click or Control-click on macOS, pinch and hold on visionOS. VoiceOver exposes the entries as the
/// element's actions. An empty `items` list attaches no menu at all, so the gesture is not swallowed.
public struct AedstContextMenuModifier: ViewModifier {
    private let items: [AedstMenuItem]

    /// - Parameter items: Menu entries, top to bottom.
    public init(items: [AedstMenuItem]) {
        self.items = items
    }

    public func body(content: Content) -> some View {
        if items.isEmpty {
            content
        } else {
            content.contextMenu {
                AedstMenuItems(items: items)
            }
        }
    }
}

extension View {
    /// Attaches a contextual menu (see `AedstContextMenuModifier` for how each platform opens it).
    ///
    /// A context menu is invisible until asked for: every command in it must also be reachable another way
    /// (a toolbar item, a swipe action, a detail screen).
    public func aedstContextMenu(items: [AedstMenuItem]) -> some View {
        modifier(AedstContextMenuModifier(items: items))
    }
}

#Preview("AedstContextMenu") {
    Text("Touch and hold, or right-click") // i18n-ok: preview
        .font(AedstTypography.body)
        .padding(AedstSpacing.xxl)
        .background(AedstColor.muted)
        .clipShape(RoundedRectangle(cornerRadius: AedstRadius.md, style: .continuous))
        .aedstContextMenu(items: [
            .action("Copy", systemImage: "doc.on.doc") {},
            .action("Share", systemImage: "square.and.arrow.up") {},
            .separator,
            .action("Delete", systemImage: "trash", variant: .destructive) {},
        ])
        .padding()
}

#endif
