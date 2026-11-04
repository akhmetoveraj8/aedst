import SwiftUI

/// `View.animation(_:value:)` that turns itself off when the user enabled
/// Settings > Accessibility > Motion > Reduce Motion (`accessibilityReduceMotion`).
/// Components use this instead of a bare `.animation` so motion sensitivity is
/// respected everywhere by construction. `AedstMotion` (generated) keeps the
/// duration tokens; this owns the accessibility policy.
private struct AedstReduceMotionAnimation<Value: Equatable>: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let animation: Animation?
    let value: Value

    func body(content: Content) -> some View {
        content.animation(reduceMotion ? nil : animation, value: value)
    }
}

extension View {
    /// Animates changes of `value`, unless Reduce Motion is on.
    public func aedstAnimation<Value: Equatable>(_ animation: Animation?, value: Value) -> some View {
        modifier(AedstReduceMotionAnimation(animation: animation, value: value))
    }
}
