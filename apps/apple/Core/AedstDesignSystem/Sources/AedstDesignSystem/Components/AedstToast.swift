import SwiftUI

/// Transient overlay notification matching shadcn/ui (`sonner`) `Toast` —
/// SwiftUI has no native toast, so this is a custom `ViewModifier` that
/// overlays a card and auto-dismisses.
public struct AedstToastData: Equatable {
    public let title: String
    public let message: String?
    public let severity: AedstAlertSeverity

    public init(title: String, message: String? = nil, severity: AedstAlertSeverity = .info) {
        self.title = title
        self.message = message
        self.severity = severity
    }

    public static func == (lhs: AedstToastData, rhs: AedstToastData) -> Bool {
        lhs.title == rhs.title && lhs.message == rhs.message
    }
}

public struct AedstToastModifier: ViewModifier {
    @Binding private var toast: AedstToastData?
    private let duration: TimeInterval
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    public init(toast: Binding<AedstToastData?>, duration: TimeInterval = 3) {
        self._toast = toast
        self.duration = duration
    }

    public func body(content: Content) -> some View {
        content.overlay(alignment: .top) {
            if let toast {
                HStack(alignment: .top, spacing: AedstSpacing.sm) {
                    Image(systemName: toast.severity.systemImage)
                        .foregroundStyle(toast.severity.tint)
                    VStack(alignment: .leading, spacing: AedstSpacing.xxs) {
                        Text(toast.title).font(AedstTypography.body.weight(.semibold))
                        if let message = toast.message {
                            Text(message).font(AedstTypography.caption).foregroundStyle(AedstColor.mutedForeground)
                        }
                    }
                    Spacer(minLength: 0)
                }
                .padding(AedstSpacing.sm)
                .background(AedstColor.popover)
                .foregroundStyle(AedstColor.popoverForeground)
                .clipShape(RoundedRectangle(cornerRadius: AedstRadius.md, style: .continuous))
                .shadow(radius: 12, y: 4)
                .padding(AedstSpacing.lg)
                .transition(.move(edge: .top).combined(with: .opacity))
                .task(id: toast) {
                    AedstAnnouncer.post(AedstAnnouncementPolicy.spokenText(title: toast.title, message: toast.message))
                    let shown = AedstAnnouncementPolicy.displayDuration(base: duration, voiceOverRunning: voiceOverEnabled)
                    try? await Task.sleep(for: .seconds(shown))
                    withAnimation(reduceMotion ? nil : .default) { self.toast = nil }
                }
                .accessibilityElement(children: .combine)
                .accessibilityAddTraits(.isStaticText)
            }
        }
        .aedstAnimation(.spring(response: 0.3), value: toast)
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
