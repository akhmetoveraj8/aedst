import SwiftUI

// iOS, macOS and visionOS only: tvOS and watchOS are scaffolded package platforms without app targets.
#if os(iOS) || os(macOS) || os(visionOS)

/// What a popover turns into where there is no room for one (iPhone, a narrow iPad split).
public enum AedstPopoverCompactStyle: Sendable {
    /// Stays an anchored bubble. For small content: a hint, a few controls.
    case popover
    /// Becomes a sheet. For content that scrolls or has a keyboard-heavy form.
    case sheet
}

/// Padding, colours and typography of the kit applied to popover content. Used by `AedstPopoverModifier`
/// and by the other anchored surfaces of the kit (hover card, tooltip, combobox, navigation menu).
struct AedstPopoverSurface<Content: View>: View {
    let compactStyle: AedstPopoverCompactStyle
    let inset: CGFloat
    let content: Content

    init(
        compactStyle: AedstPopoverCompactStyle = .popover,
        inset: CGFloat = AedstSpacing.lg,
        @ViewBuilder content: () -> Content
    ) {
        self.compactStyle = compactStyle
        self.inset = inset
        self.content = content()
    }

    var body: some View {
        content
            .font(AedstTypography.body)
            .foregroundStyle(AedstColor.popoverForeground)
            .padding(inset)
            .presentationBackground(AedstColor.popover)
            .presentationCompactAdaptation(compactStyle == .popover ? .popover : .sheet)
    }
}

/// `.popover()` wrapper matching shadcn/ui `Popover`: a `ViewModifier` on the trigger, like `aedstSheet`.
///
/// Native behaviour is kept: an arrow pointing at the trigger, dismissal by a tap outside or Escape, and
/// VoiceOver treating the content as a modal region. `compactStyle` chooses what happens on iPhone, where the
/// system would otherwise always turn a popover into a sheet.
public struct AedstPopoverModifier<PopoverContent: View>: ViewModifier {
    @Binding private var isPresented: Bool
    private let arrowEdge: Edge
    private let compactStyle: AedstPopoverCompactStyle
    private let popoverContent: PopoverContent

    /// - Parameters:
    ///   - arrowEdge: Edge of the trigger the popover prefers to attach to (the system may move it to fit).
    ///   - compactStyle: Presentation in a compact width.
    public init(
        isPresented: Binding<Bool>,
        arrowEdge: Edge = .top,
        compactStyle: AedstPopoverCompactStyle = .popover,
        @ViewBuilder content: () -> PopoverContent
    ) {
        self._isPresented = isPresented
        self.arrowEdge = arrowEdge
        self.compactStyle = compactStyle
        self.popoverContent = content()
    }

    public func body(content: Content) -> some View {
        content.popover(isPresented: $isPresented, attachmentAnchor: .rect(.bounds), arrowEdge: arrowEdge) {
            AedstPopoverSurface(compactStyle: compactStyle) {
                popoverContent
            }
        }
    }
}

/// Title and description block for the top of a popover (shadcn/ui `PopoverHeader`).
public struct AedstPopoverHeader: View {
    private let title: String
    private let description: String?

    /// - Parameters:
    ///   - title: Already localized title.
    ///   - description: Optional supporting text.
    public init(_ title: String, description: String? = nil) {
        self.title = title
        self.description = description
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: AedstSpacing.xxs) {
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
    }
}

extension View {
    /// Shows `content` in a popover anchored to this view while `isPresented` is true.
    public func aedstPopover<Content: View>(
        isPresented: Binding<Bool>,
        arrowEdge: Edge = .top,
        compactStyle: AedstPopoverCompactStyle = .popover,
        @ViewBuilder content: @escaping () -> Content
    ) -> some View {
        modifier(
            AedstPopoverModifier(
                isPresented: isPresented,
                arrowEdge: arrowEdge,
                compactStyle: compactStyle,
                content: content
            )
        )
    }
}

#Preview("AedstPopover") {
    @Previewable @State var isPresented = true
    @Previewable @State var width = "100%"
    AedstButton("Dimensions", variant: .outline, fillsWidth: false) { isPresented = true }
        .aedstPopover(isPresented: $isPresented) {
            VStack(alignment: .leading, spacing: AedstSpacing.md) {
                AedstPopoverHeader("Dimensions", description: "Set the dimensions for the layer.")
                AedstTextField("Width", text: $width)
            }
            .frame(minWidth: 240)
        }
        .padding()
}

#endif
