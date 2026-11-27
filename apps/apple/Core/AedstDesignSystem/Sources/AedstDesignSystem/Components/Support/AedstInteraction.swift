import SwiftUI

/// A visible keyboard-focus ring (macOS full keyboard access, iPad hardware keyboard, tvOS focus). Reads the
/// `isFocused` environment value of the nearest focusable ancestor, so apply it inside a `Button` label or to a
/// focusable view.
struct AedstFocusRing: ViewModifier {
    let cornerRadius: CGFloat
    @Environment(\.isFocused) private var isFocused

    func body(content: Content) -> some View {
        content.overlay {
            if isFocused {
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .strokeBorder(AedstColor.ring, lineWidth: 2)
                    .allowsHitTesting(false)
            }
        }
    }
}

/// State overlays of a pressable control, as pure numbers (unit-tested).
enum AedstInteractionOpacity {
    static let pressed = 0.14
    static let hovered = 0.07

    /// Opacity of the foreground-coloured wash over a control: pressed beats hovered, rest is clear.
    static func wash(isPressed: Bool, isHovered: Bool) -> Double {
        if isPressed { return pressed }
        return isHovered ? hovered : 0
    }
}

/// The kit's button style for every `Button` that draws its own chrome: a pressed wash, a pointer-hover wash
/// where a pointer exists (macOS, iPadOS, visionOS) and a visible focus ring. It replaces `.buttonStyle(.plain)`,
/// which has no focus indicator of its own on macOS and tvOS.
struct AedstPressableButtonStyle: ButtonStyle {
    let cornerRadius: CGFloat
    /// `false` when the control already highlights itself on hover (a sidebar row).
    var showsHover = true

    func makeBody(configuration: ButtonStyleConfiguration) -> some View {
        AedstPressableButtonBody(configuration: configuration, cornerRadius: cornerRadius, showsHover: showsHover)
    }
}

private struct AedstPressableButtonBody: View {
    let configuration: ButtonStyleConfiguration
    let cornerRadius: CGFloat
    let showsHover: Bool
    @State private var isHovered = false

    var body: some View {
        let wash = AedstInteractionOpacity.wash(isPressed: configuration.isPressed, isHovered: isHovered && showsHover)
        configuration.label
            .overlay {
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .fill(AedstColor.foreground.opacity(wash))
                    .allowsHitTesting(false)
            }
            .modifier(AedstFocusRing(cornerRadius: cornerRadius))
            #if !os(tvOS) && !os(watchOS)
            .onHover { isHovered = $0 }
            #endif
            .focusEffectDisabled()
    }
}

/// A haptic the kit plays for a state change. Mapped to `SensoryFeedback` where it exists (not on tvOS).
public enum AedstHaptic: Sendable, CaseIterable {
    /// A value or choice changed (toggle, switch, checkbox, slider step).
    case selection
    case success
    case warning
    case error
    /// A weighty confirmation (a destructive action was confirmed).
    case impact

    /// The haptic of a toast: the severity decides, so an error is felt differently from an info.
    public static func toast(_ severity: AedstToastSeverity) -> AedstHaptic? {
        switch severity {
        case .info: nil
        case .success: .success
        case .warning: .warning
        case .destructive: .error
        }
    }

    #if !os(tvOS)
    var feedback: SensoryFeedback {
        switch self {
        case .selection: .selection
        case .success: .success
        case .warning: .warning
        case .error: .error
        case .impact: .impact
        }
    }
    #endif
}

extension View {
    /// Plays `haptic` whenever `trigger` changes (`sensoryFeedback`); no-op on tvOS. The system skips it where the
    /// hardware has no haptic engine.
    func aedstHaptic<Trigger: Equatable>(_ haptic: AedstHaptic, trigger: Trigger) -> some View {
        #if os(tvOS)
        self
        #else
        sensoryFeedback(haptic.feedback, trigger: trigger)
        #endif
    }

    /// Like `aedstHaptic`, but plays nothing when `haptic` is `nil` (an info toast).
    @ViewBuilder
    func aedstOptionalHaptic<Trigger: Equatable>(_ haptic: AedstHaptic?, trigger: Trigger) -> some View {
        if let haptic {
            aedstHaptic(haptic, trigger: trigger)
        } else {
            self
        }
    }

    /// Tells VoiceOver the screen changed once a presentation has settled, so focus moves to its first element
    /// (a sheet, a palette). The system returns focus to the presenting control when it closes.
    func aedstAnnounceScreenChange() -> some View {
        task {
            try? await Task.sleep(for: .milliseconds(AedstFocusPolicy.settleMilliseconds))
            AccessibilityNotification.ScreenChanged().post()
        }
    }

    /// Moves VoiceOver focus to this view when it appears (a dialog title, a toast). The short wait lets the
    /// presentation finish first; without it the focus request is dropped.
    func aedstInitialAccessibilityFocus(_ isEnabled: Bool = true) -> some View {
        modifier(AedstInitialAccessibilityFocus(isEnabled: isEnabled))
    }
}

/// See `View.aedstInitialAccessibilityFocus`.
private struct AedstInitialAccessibilityFocus: ViewModifier {
    let isEnabled: Bool
    @AccessibilityFocusState private var isFocused: Bool

    func body(content: Content) -> some View {
        content
            .accessibilityFocused($isFocused)
            .task {
                guard isEnabled else { return }
                try? await Task.sleep(for: .milliseconds(AedstFocusPolicy.settleMilliseconds))
                isFocused = true
            }
    }
}

/// Timing of focus moves, as constants the tests can read.
enum AedstFocusPolicy {
    /// Wait after a presentation starts before VoiceOver focus is moved into it.
    static let settleMilliseconds = 350
}
