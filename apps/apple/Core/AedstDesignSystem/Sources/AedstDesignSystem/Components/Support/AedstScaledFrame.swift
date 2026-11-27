import SwiftUI

/// A frame whose numbers grow with Dynamic Type (`@ScaledMetric`, relative to a text style). Use it for control
/// heights, icon boxes and slots that sit next to text, so the box keeps its proportion to the glyphs at the
/// accessibility sizes. Pure arithmetic lives in `AedstLayoutPolicy`, which the tests cover.
struct AedstScaledFrame: ViewModifier {
    enum Kind: Sendable {
        /// `.frame(width:height:)`: an exact box (icon slot, checkbox, avatar).
        case fixed
        /// `.frame(minWidth:minHeight:)`: a floor that content may exceed (control rows).
        case minimum
    }

    @ScaledMetric private var width: CGFloat
    @ScaledMetric private var height: CGFloat
    private let kind: Kind
    private let usesWidth: Bool
    private let usesHeight: Bool
    private let alignment: Alignment

    init(
        kind: Kind,
        width: CGFloat?,
        height: CGFloat?,
        relativeTo style: Font.TextStyle,
        alignment: Alignment
    ) {
        self.kind = kind
        self.usesWidth = width != nil
        self.usesHeight = height != nil
        self.alignment = alignment
        self._width = ScaledMetric(wrappedValue: width ?? 0, relativeTo: style)
        self._height = ScaledMetric(wrappedValue: height ?? 0, relativeTo: style)
    }

    @ViewBuilder
    func body(content: Content) -> some View {
        switch kind {
        case .fixed:
            content.frame(width: usesWidth ? width : nil, height: usesHeight ? height : nil, alignment: alignment)
        case .minimum:
            content.frame(minWidth: usesWidth ? width : nil, minHeight: usesHeight ? height : nil, alignment: alignment)
        }
    }
}

extension View {
    /// An exact `width` x `height` box that scales with Dynamic Type relative to `style`.
    func aedstScaledFrame(
        width: CGFloat? = nil,
        height: CGFloat? = nil,
        relativeTo style: Font.TextStyle = .body,
        alignment: Alignment = .center
    ) -> some View {
        modifier(AedstScaledFrame(kind: .fixed, width: width, height: height, relativeTo: style, alignment: alignment))
    }

    /// A floor of `minWidth` x `minHeight` that scales with Dynamic Type relative to `style`.
    func aedstScaledMinFrame(
        minWidth: CGFloat? = nil,
        minHeight: CGFloat? = nil,
        relativeTo style: Font.TextStyle = .body,
        alignment: Alignment = .center
    ) -> some View {
        modifier(AedstScaledFrame(kind: .minimum, width: minWidth, height: minHeight, relativeTo: style, alignment: alignment))
    }
}

/// Layout decisions that depend on the text size or the layout direction, as pure functions (unit-tested).
public enum AedstLayoutPolicy {
    /// At the accessibility sizes a row of side-by-side actions or a one-line label no longer fits: stack it
    /// and allow wrapping.
    public static func prefersStackedLayout(_ size: DynamicTypeSize) -> Bool {
        size.isAccessibilitySize
    }

    /// Line limit for a label that is normally one line: unlimited at the accessibility sizes, so text wraps
    /// instead of being cut.
    public static func lineLimit(_ normal: Int, for size: DynamicTypeSize) -> Int? {
        size.isAccessibilitySize ? nil : normal
    }

    /// +1 moves toward the trailing edge, -1 toward the leading edge: the sign to apply to a physical x offset
    /// (an `.offset(x:)`, a gradient sweep) so it follows the layout direction.
    public static func inlineSign(for direction: LayoutDirection) -> CGFloat {
        direction == .rightToLeft ? -1 : 1
    }

    /// Physical x offset of a sweep (a shimmer highlight) across a view `width` points wide: it starts one width
    /// before the leading edge and ends one width after the trailing edge, in either direction.
    public static func sweepOffset(isAtEnd: Bool, width: CGFloat, direction: LayoutDirection) -> CGFloat {
        (isAtEnd ? width : -width) * inlineSign(for: direction)
    }

    /// The tappable minimum of a control on a touch platform: its drawn height or 44 pt, whichever is larger.
    /// (macOS keeps the drawn height: the pointer is precise.)
    public static func hitHeight(drawn: CGFloat, isTouch: Bool) -> CGFloat {
        isTouch ? max(drawn, AedstHitTarget.minimum) : drawn
    }
}
