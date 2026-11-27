import SwiftUI

/// Height stops a sheet may rest at. Mirrors the two `PresentationDetent`s the
/// design system uses, keeping `PresentationDetent` out of call sites.
public enum AedstSheetDetent: Hashable, Sendable {
    /// Half-height stop.
    case medium
    /// Full-height stop.
    case large

    var presentationDetent: PresentationDetent {
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
            // VoiceOver moves into the sheet when it opens; the system hands focus back to the presenter on close.
            .aedstAnnounceScreenChange()
    }
}

/// `.sheet()` wrapper matching shadcn/ui `Sheet` — thin convenience so
/// screens get consistent detents/drag-indicator behavior instead of
/// re-deriving it per call site.
public struct AedstSheetModifier<SheetContent: View>: ViewModifier {
    @Binding private var isPresented: Bool
    private let detents: Set<AedstSheetDetent>
    private let returnFocus: AedstFocusReturn?
    private let sheetContent: SheetContent

    /// - Parameter returnFocus: Where focus goes when the sheet closes (the caller's trigger); see `AedstFocusReturn`.
    public init(
        isPresented: Binding<Bool>,
        detents: Set<AedstSheetDetent> = [.medium, .large],
        returnFocus: AedstFocusReturn? = nil,
        @ViewBuilder content: () -> SheetContent
    ) {
        self._isPresented = isPresented
        self.detents = detents
        self.returnFocus = returnFocus
        self.sheetContent = content()
    }

    public func body(content: Content) -> some View {
        content.aedstReturnsFocus(whenPresented: isPresented, to: returnFocus).sheet(isPresented: $isPresented) {
            sheetContent
                .modifier(AedstSheetPresentationModifier(detents: detents))
        }
    }
}

/// Item-driven variant of `AedstSheetModifier`: the sheet shows while `item` is non-nil.
public struct AedstItemSheetModifier<Item: Identifiable, SheetContent: View>: ViewModifier {
    @Binding private var item: Item?
    private let detents: Set<AedstSheetDetent>
    private let returnFocus: AedstFocusReturn?
    private let sheetContent: (Item) -> SheetContent

    /// - Parameter returnFocus: Where focus goes when the sheet closes (the caller's trigger); see `AedstFocusReturn`.
    public init(
        item: Binding<Item?>,
        detents: Set<AedstSheetDetent> = [.medium, .large],
        returnFocus: AedstFocusReturn? = nil,
        @ViewBuilder content: @escaping (Item) -> SheetContent
    ) {
        self._item = item
        self.detents = detents
        self.returnFocus = returnFocus
        self.sheetContent = content
    }

    public func body(content: Content) -> some View {
        content.aedstReturnsFocus(whenPresented: item != nil, to: returnFocus).sheet(item: $item) { item in
            sheetContent(item)
                .modifier(AedstSheetPresentationModifier(detents: detents))
        }
    }
}

extension View {
    public func aedstSheet<Content: View>(
        isPresented: Binding<Bool>,
        detents: Set<AedstSheetDetent> = [.medium, .large],
        returnFocus: AedstFocusReturn? = nil,
        @ViewBuilder content: @escaping () -> Content
    ) -> some View {
        modifier(AedstSheetModifier(isPresented: isPresented, detents: detents, returnFocus: returnFocus, content: content))
    }

    /// Sheet bound to an optional item (shown while non-nil), with the design system's detents and background.
    public func aedstSheet<Item: Identifiable, Content: View>(
        item: Binding<Item?>,
        detents: Set<AedstSheetDetent> = [.medium, .large],
        returnFocus: AedstFocusReturn? = nil,
        @ViewBuilder content: @escaping (Item) -> Content
    ) -> some View {
        modifier(AedstItemSheetModifier(item: item, detents: detents, returnFocus: returnFocus, content: content))
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
