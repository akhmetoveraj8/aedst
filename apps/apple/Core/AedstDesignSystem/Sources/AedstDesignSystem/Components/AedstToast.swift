import SwiftUI

/// Kind of a toast: picks the icon and its colour (sonner's `info` / `success` / `warning` / `error` toasts).
public enum AedstToastSeverity: Sendable, CaseIterable {
    case info
    case success
    case warning
    case destructive

    var systemImage: String {
        switch self {
        case .info: "info.circle.fill"
        case .success: "checkmark.circle.fill"
        case .warning: "exclamationmark.triangle.fill"
        case .destructive: "xmark.octagon.fill"
        }
    }

    var tint: Color {
        switch self {
        case .info: AedstColor.foreground
        case .success: AedstColor.success
        case .warning: AedstColor.warning
        case .destructive: AedstColor.destructive
        }
    }
}

/// Transient overlay notification matching shadcn/ui (`sonner`) `Toast` —
/// SwiftUI has no native toast, so this is a custom `ViewModifier` that
/// overlays a card and auto-dismisses.
///
/// Equality includes the severity, so showing the same text with another severity restarts the timer, the
/// announcement and the haptic (`task(id:)` keys on it).
public struct AedstToastData: Equatable, Sendable {
    public let title: String
    public let message: String?
    public let severity: AedstToastSeverity

    public init(title: String, message: String? = nil, severity: AedstToastSeverity = .info) {
        self.title = title
        self.message = message
        self.severity = severity
    }
}

/// Pure rules of the toast gestures and focus, unit-tested.
public enum AedstToastPolicy {
    /// An upward drag of at least this many points dismisses the toast.
    public static let swipeDismissDistance: CGFloat = 40

    /// Vertical offset while dragging: the card follows the finger upward only.
    public static func dragOffset(translationHeight: CGFloat) -> CGFloat {
        min(translationHeight, 0)
    }

    /// Whether a finished drag dismisses the toast.
    public static func shouldDismiss(translationHeight: CGFloat) -> Bool {
        translationHeight <= -swipeDismissDistance
    }

    /// Whether the countdown waits: a pointer over the toast, a finger on it, keyboard focus on its button or
    /// VoiceOver focus on its text.
    public static func isPaused(isHovering: Bool, isTouching: Bool, hasKeyboardFocus: Bool, hasAccessibilityFocus: Bool) -> Bool {
        isHovering || isTouching || hasKeyboardFocus || hasAccessibilityFocus
    }

    /// An error needs a decision, so VoiceOver focus moves to it; every other kind is only announced.
    public static func movesAccessibilityFocus(for severity: AedstToastSeverity) -> Bool {
        severity == .destructive
    }
}

/// What restarts the countdown: a new toast, or a pause beginning or ending.
private struct AedstToastTimerKey: Equatable {
    let toast: AedstToastData
    let isPaused: Bool
}

public struct AedstToastModifier: ViewModifier {
    @Binding private var toast: AedstToastData?
    private let duration: TimeInterval
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.accessibilityVoiceOverEnabled) private var voiceOverEnabled
    @State private var isHovering = false
    @State private var isTouching = false
    @State private var dragHeight: CGFloat = 0
    @FocusState private var dismissHasFocus: Bool
    @AccessibilityFocusState private var textHasAccessibilityFocus: Bool

    public init(toast: Binding<AedstToastData?>, duration: TimeInterval = 3) {
        self._toast = toast
        self.duration = duration
    }

    public func body(content: Content) -> some View {
        content
            .overlay(alignment: .top) {
                if let toast { card(toast) }
            }
            .aedstAnimation(.spring(response: 0.3), value: toast)
            .aedstOptionalHaptic(toast.flatMap { AedstHaptic.toast($0.severity) }, trigger: toast)
    }

    private var isPaused: Bool {
        AedstToastPolicy.isPaused(
            isHovering: isHovering, isTouching: isTouching,
            hasKeyboardFocus: dismissHasFocus, hasAccessibilityFocus: textHasAccessibilityFocus
        )
    }

    private func dismiss() {
        // VoiceOver focus would be left on a view that is going away: ask it to find a new element.
        if textHasAccessibilityFocus { AccessibilityNotification.LayoutChanged().post() }
        withAnimation(reduceMotion ? nil : .default) { toast = nil }
    }

    private func card(_ toast: AedstToastData) -> some View {
        HStack(alignment: .top, spacing: AedstSpacing.sm) {
            HStack(alignment: .top, spacing: AedstSpacing.sm) {
                Image(systemName: toast.severity.systemImage)
                    .foregroundStyle(toast.severity.tint)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: AedstSpacing.xxs) {
                    Text(toast.title).font(AedstTypography.body.weight(.semibold))
                    if let message = toast.message {
                        Text(message).font(AedstTypography.caption).foregroundStyle(AedstColor.mutedForeground)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .accessibilityElement(children: .combine)
            .accessibilityFocused($textHasAccessibilityFocus)

            AedstIconButton(systemImage: "xmark", accessibilityLabel: AedstStrings.dismissNotification, size: .iconSm) {
                dismiss()
            }
            .focused($dismissHasFocus)
        }
        .padding(AedstSpacing.sm)
        .background(AedstColor.popover)
        .foregroundStyle(AedstColor.popoverForeground)
        .clipShape(RoundedRectangle(cornerRadius: AedstRadius.md, style: .continuous))
        .shadow(radius: AedstElevation.level5, y: AedstElevation.level2)
        .padding(AedstSpacing.lg)
        .offset(y: dragHeight)
        .transition(.move(edge: .top).combined(with: .opacity))
        .accessibilityElement(children: .contain)
        .accessibilityAction(.escape) { dismiss() }
        .simultaneousGesture(swipe)
        #if !os(tvOS) && !os(watchOS)
        .onHover { isHovering = $0 }
        #endif
        .task(id: toast) {
            let movesFocus = AedstToastPolicy.movesAccessibilityFocus(for: toast.severity)
            if !movesFocus {
                AedstAnnouncer.post(AedstAnnouncementPolicy.spokenText(title: toast.title, message: toast.message))
            } else if voiceOverEnabled {
                try? await Task.sleep(for: .milliseconds(AedstFocusPolicy.settleMilliseconds))
                textHasAccessibilityFocus = true
            }
        }
        .task(id: AedstToastTimerKey(toast: toast, isPaused: isPaused)) {
            guard !isPaused else { return }
            let shown = AedstAnnouncementPolicy.displayDuration(base: duration, voiceOverRunning: voiceOverEnabled)
            try? await Task.sleep(for: .seconds(shown))
            guard !Task.isCancelled else { return }
            dismiss()
        }
    }

    /// Dragging up dismisses; touching at all pauses the countdown. Simultaneous, so the close button keeps its tap.
    private var swipe: some Gesture {
        DragGesture(minimumDistance: 0)
            .onChanged { value in
                isTouching = true
                dragHeight = AedstToastPolicy.dragOffset(translationHeight: value.translation.height)
            }
            .onEnded { value in
                isTouching = false
                dragHeight = 0
                if AedstToastPolicy.shouldDismiss(translationHeight: value.translation.height) { dismiss() }
            }
    }
}

extension View {
    public func aedstToast(_ toast: Binding<AedstToastData?>, duration: TimeInterval = 3) -> some View {
        modifier(AedstToastModifier(toast: toast, duration: duration))
    }
}

#Preview("AedstToast") {
    @Previewable @State var toast: AedstToastData? = AedstToastData(
        title: "Saved",
        message: "Your changes are live.",
        severity: .success
    )
    Color.clear.aedstToast($toast)
}
