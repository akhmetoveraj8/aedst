import SwiftUI

/// Minimum size of a touch target (Human Interface Guidelines: 44 x 44 pt).
public enum AedstHitTarget {
    /// Shortest side of anything a finger has to hit.
    public static let minimum: CGFloat = 44
}

extension View {
    /// Grows the tappable area to at least 44 x 44 pt on touch platforms without changing the visible chrome:
    /// apply it to the label of a control whose drawn shape is smaller (an `xs` button, a toggle, a page link).
    /// On macOS the pointer is precise, so the view is returned unchanged and dense layouts stay dense.
    public func aedstHitTarget() -> some View {
        #if os(macOS)
        self
        #else
        frame(minWidth: AedstHitTarget.minimum, minHeight: AedstHitTarget.minimum)
            .contentShape(Rectangle())
        #endif
    }
}
