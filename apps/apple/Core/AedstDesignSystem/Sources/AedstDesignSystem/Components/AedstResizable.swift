import SwiftUI

// iOS, macOS and visionOS only: tvOS and watchOS are scaffolded package platforms without app targets.
#if os(iOS) || os(macOS) || os(visionOS)

/// Direction in which the two panes of an `AedstResizable` are laid out (shadcn `ResizablePanelGroup`'s
/// `orientation`).
public enum AedstResizableAxis: Sendable, CaseIterable {
    /// Panes side by side (leading / trailing); the handle moves horizontally.
    case horizontal
    /// Panes stacked (top / bottom); the handle moves vertically.
    case vertical
}

/// Two panes with a draggable divider matching shadcn/ui `Resizable` (`ResizablePanelGroup` with two
/// `ResizablePanel`s and a `ResizableHandle`). `fraction` is the first pane's share of the space.
///
/// The handle is a thin rule with a larger invisible grab area (44 pt on touch platforms, 12 pt with a resize
/// pointer on the Mac). For VoiceOver and Switch Control it is an adjustable element: increment and decrement
/// move it by 5 %. In a right-to-left layout the first pane is on the right and dragging is mirrored.
public struct AedstResizable<First: View, Second: View>: View {
    private let axis: AedstResizableAxis
    @Binding private var fraction: Double
    private let range: ClosedRange<Double>
    private let first: First
    private let second: Second
    @State private var dragStartFraction: Double?
    @Environment(\.layoutDirection) private var layoutDirection

    /// - Parameters:
    ///   - axis: Layout direction of the panes.
    ///   - fraction: Share of the first pane, `0...1`.
    ///   - range: Limits of `fraction` (the minimum sizes of the two panes).
    public init(
        axis: AedstResizableAxis = .horizontal,
        fraction: Binding<Double>,
        range: ClosedRange<Double> = 0.2...0.8,
        @ViewBuilder first: () -> First,
        @ViewBuilder second: () -> Second
    ) {
        self.axis = axis
        self._fraction = fraction
        self.range = range
        self.first = first()
        self.second = second()
    }

    public var body: some View {
        GeometryReader { proxy in
            let total = axis == .horizontal ? proxy.size.width : proxy.size.height
            let firstLength = max(total * AedstResizableMath.clamped(fraction, to: range), 0)
            if axis == .horizontal {
                HStack(spacing: AedstSpacing.none) {
                    first.frame(width: firstLength)
                    handle(total: total)
                    second.frame(maxWidth: .infinity)
                }
            } else {
                VStack(spacing: AedstSpacing.none) {
                    first.frame(height: firstLength)
                    handle(total: total)
                    second.frame(maxHeight: .infinity)
                }
            }
        }
    }

    private static var grabThickness: CGFloat {
        #if os(macOS)
        AedstSpacing.md
        #else
        AedstHitTarget.minimum
        #endif
    }

    private func handle(total: CGFloat) -> some View {
        Rectangle()
            .fill(AedstColor.border)
            .frame(
                width: axis == .horizontal ? 1 : nil,
                height: axis == .vertical ? 1 : nil
            )
            .overlay {
                Color.clear
                    .frame(
                        width: axis == .horizontal ? Self.grabThickness : nil,
                        height: axis == .vertical ? Self.grabThickness : nil
                    )
                    .contentShape(Rectangle())
                    #if os(macOS)
                    .pointerStyle(axis == .horizontal ? PointerStyle.columnResize : PointerStyle.rowResize)
                    #endif
                    .gesture(drag(total: total))
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(AedstStrings.resizeHandle))
            .accessibilityValue(Text(AedstStrings.percent(Int((AedstResizableMath.clamped(fraction, to: range) * 100).rounded()))))
            .accessibilityAdjustableAction { direction in
                switch direction {
                case .increment: fraction = AedstResizableMath.clamped(fraction + AedstResizableMath.step, to: range)
                case .decrement: fraction = AedstResizableMath.clamped(fraction - AedstResizableMath.step, to: range)
                @unknown default: break
                }
            }
    }

    private func drag(total: CGFloat) -> some Gesture {
        DragGesture(minimumDistance: 1, coordinateSpace: .global)
            .onChanged { value in
                let start = dragStartFraction ?? fraction
                dragStartFraction = start
                var translation = axis == .horizontal ? value.translation.width : value.translation.height
                // Global coordinates are not mirrored: in right-to-left the first pane grows to the left.
                if axis == .horizontal, layoutDirection == .rightToLeft { translation = -translation }
                fraction = AedstResizableMath.fraction(start: start, translation: translation, total: total, range: range)
            }
            .onEnded { _ in
                dragStartFraction = nil
            }
    }
}

/// Divider arithmetic of `AedstResizable`, kept out of the generic view so it can be unit-tested.
enum AedstResizableMath {
    /// Keyboard / assistive-technology step.
    static let step = 0.05

    static func clamped(_ fraction: Double, to range: ClosedRange<Double>) -> Double {
        min(max(fraction, range.lowerBound), range.upperBound)
    }

    /// The first pane's share after dragging the handle by `translation` points along a `total`-point axis.
    static func fraction(start: Double, translation: CGFloat, total: CGFloat, range: ClosedRange<Double>) -> Double {
        guard total > 0 else { return clamped(start, to: range) }
        return clamped(start + Double(translation / total), to: range)
    }
}

#Preview("AedstResizable") {
    @Previewable @State var fraction = 0.4
    AedstResizable(fraction: $fraction) {
        Text("One").frame(maxWidth: .infinity, maxHeight: .infinity) // i18n-ok: preview
    } second: {
        Text("Two").frame(maxWidth: .infinity, maxHeight: .infinity) // i18n-ok: preview
    }
    .frame(height: 160)
    .padding()
}

#endif
