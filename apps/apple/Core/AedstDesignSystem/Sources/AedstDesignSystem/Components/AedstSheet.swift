import SwiftUI

/// Height stops a sheet may rest at. Mirrors the two `PresentationDetent`s the
/// design system uses, keeping `PresentationDetent` out of call sites.
public enum AedstSheetDetent: Hashable, Sendable {
    /// Half-height stop.
    case medium
    /// Full-height stop.
    case large

    fileprivate var presentationDetent: PresentationDetent {
        switch self {
        case .medium: .medium
        case .large: .large
        }
    }
}

/// Applies detents, drag indicator and background to the sheet content.
private struct AedstSheetPresentationModifier: ViewModifier {
    let detents: Set<AedstSheetDetent>

    func body(content: Content) -> some View {
        content
            .presentationDetents(Set(detents.map(\.presentationDetent)))
            .presentationDragIndicator(.visible)
            .presentationBackground(AedstColor.background)
    }
}

/// `.sheet()` wrapper matching shadcn/ui `Sheet` — thin convenience so
/// screens get consistent detents/drag-indicator behavior instead of
/// re-deriving it per call site.
public struct AedstSheetModifier<SheetContent: View>: ViewModifier {
    @Binding private var isPresented: Bool
    private let detents: Set<AedstSheetDetent>
    private let sheetContent: SheetContent

    public init(
        isPresented: Binding<Bool>,
        detents: Set<AedstSheetDetent> = [.medium, .large],
        @ViewBuilder content: () -> SheetContent
    ) {
        self._isPresented = isPresented
        self.detents = detents
        self.sheetContent = content()
    }

    public func body(content: Content) -> some View {
        content.sheet(isPresented: $isPresented) {
            sheetContent
                .modifier(AedstSheetPresentationModifier(detents: detents))
        }
    }
}

/// Item-driven variant of `AedstSheetModifier`: the sheet shows while `item` is non-nil.
public struct AedstItemSheetModifier<Item: Identifiable, SheetContent: View>: ViewModifier {
    @Binding private var item: Item?
    private let detents: Set<AedstSheetDetent>
    private let sheetContent: (Item) -> SheetContent

    public init(
        item: Binding<Item?>,
        detents: Set<AedstSheetDetent> = [.medium, .large],
        @ViewBuilder content: @escaping (Item) -> SheetContent
    ) {
        self._item = item
        self.detents = detents
        self.sheetContent = content
    }

    public func body(content: Content) -> some View {
        content.sheet(item: $item) { item in
            sheetContent(item)
                .modifier(AedstSheetPresentationModifier(detents: detents))
        }
    }
}

extension View {
    public func aedstSheet<Content: View>(
        isPresented: Binding<Bool>,
        detents: Set<AedstSheetDetent> = [.medium, .large],
        @ViewBuilder content: @escaping () -> Content
    ) -> some View {
        modifier(AedstSheetModifier(isPresented: isPresented, detents: detents, content: content))
    }

    /// Sheet bound to an optional item (shown while non-nil), with the design system's detents and background.
    public func aedstSheet<Item: Identifiable, Content: View>(
        item: Binding<Item?>,
        detents: Set<AedstSheetDetent> = [.medium, .large],
        @ViewBuilder content: @escaping (Item) -> Content
    ) -> some View {
        modifier(AedstItemSheetModifier(item: item, detents: detents, content: content))
    }
}

#Preview("AedstSheet") {
    @Previewable @State var isPresented = true
    Color.clear
        .aedstSheet(isPresented: $isPresented) {
            VStack(spacing: AedstSpacing.lg) {
                Text("Filters").font(AedstTypography.title) // i18n-ok: preview
                AedstButton("Apply") {}
            }
            .padding()
        }
}
