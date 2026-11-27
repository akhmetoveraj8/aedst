import SwiftUI

/// Where VoiceOver or keyboard focus goes when a presentation (dialog, alert dialog, sheet, drawer, command
/// palette) closes. The kit does not own the control that opened the presentation, so the caller names it:
///
///     @AccessibilityFocusState private var editIsFocused: Bool
///     ...
///     AedstButton("Edit") { isEditing = true }
///         .accessibilityFocused($editIsFocused)
///         .aedstDialog(isPresented: $isEditing, title: "Edit", returnFocus: .init(accessibility: $editIsFocused)) { ... }
///
/// Keyboard focus (a text field, a macOS focusable control) uses `init(keyboard:)` with a `@FocusState`.
/// Without it the system's own restoration applies, which is not guaranteed to land on the trigger.
@MainActor
public struct AedstFocusReturn {
    private let focus: () -> Void

    /// Returns VoiceOver focus: sets the bound `@AccessibilityFocusState` to `true`.
    public init(accessibility: AccessibilityFocusState<Bool>.Binding) {
        self.focus = { accessibility.wrappedValue = true }
    }

    /// Returns keyboard focus: sets the bound `@FocusState` to `true`.
    public init(keyboard: FocusState<Bool>.Binding) {
        self.focus = { keyboard.wrappedValue = true }
    }

    /// Runs `action` when the presentation closes (several targets, or a focus mechanism the kit does not know).
    public init(_ action: @escaping () -> Void) {
        self.focus = action
    }

    func callAsFunction() { focus() }
}

/// When focus is returned, as pure logic (unit-tested).
enum AedstFocusReturnPolicy {
    /// Focus returns on the transition from presented to dismissed, never on the first render or on opening.
    static func shouldReturn(wasPresented: Bool, isPresented: Bool) -> Bool {
        wasPresented && !isPresented
    }
}

private struct AedstFocusReturnModifier: ViewModifier {
    let isPresented: Bool
    let target: AedstFocusReturn?
    @State private var wasPresented = false

    func body(content: Content) -> some View {
        content.task(id: isPresented) {
            let shouldReturn = AedstFocusReturnPolicy.shouldReturn(wasPresented: wasPresented, isPresented: isPresented)
            wasPresented = isPresented
            guard shouldReturn, let target else { return }
            // Wait until the dismissal animation ends; a focus request made earlier is dropped.
            try? await Task.sleep(for: .milliseconds(AedstFocusPolicy.settleMilliseconds))
            guard !Task.isCancelled else { return }
            target()
        }
    }
}

extension View {
    /// Returns focus to the caller-named trigger after `isPresented` goes from `true` to `false`. No-op when
    /// `target` is `nil`.
    func aedstReturnsFocus(whenPresented isPresented: Bool, to target: AedstFocusReturn?) -> some View {
        modifier(AedstFocusReturnModifier(isPresented: isPresented, target: target))
    }
}
