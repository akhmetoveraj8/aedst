import SwiftUI

// iOS, macOS and visionOS only: tvOS and watchOS are scaffolded package platforms without app targets.
#if os(iOS) || os(macOS) || os(visionOS)

/// Short hint for a control, matching shadcn/ui `Tooltip`.
///
/// - macOS: the native tooltip (`help`), shown by the system after the pointer rests on the control.
/// - iOS, iPadOS, visionOS: there is no hover on touch, so touch and hold shows the text in a small popover
///   that goes away by itself; `help` still supplies the hint for a pointer and for VoiceOver.
///
/// A tooltip repeats or expands what the control already says. Never put the only copy of an instruction or an
/// error there: it is invisible until asked for.
public struct AedstTooltipModifier: ViewModifier {
    private let text: String
    private let duration: Duration

    #if !os(macOS)
    @State private var isPresented = false
    #endif

    /// - Parameters:
    ///   - text: Already localized hint.
    ///   - duration: How long the touch popover stays (ignored on macOS, where the system owns the timing).
    public init(_ text: String, duration: Duration = .seconds(3)) {
        self.text = text
        self.duration = duration
    }

    public func body(content: Content) -> some View {
        #if os(macOS)
        content.help(text)
        #else
        content
            .help(text)
            // Simultaneous, so the control's own tap keeps working.
            .simultaneousGesture(
                LongPressGesture(minimumDuration: 0.5).onEnded { _ in
                    isPresented = true
                }
            )
            .popover(isPresented: $isPresented, attachmentAnchor: .rect(.bounds), arrowEdge: Edge.bottom) {
                AedstPopoverSurface(inset: AedstSpacing.sm) {
                    Text(text)
                        .font(AedstTypography.caption)
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: 280)
                }
                .task {
                    // VoiceOver already reads the hint from `help`; the bubble is for sighted touch users.
                    try? await Task.sleep(for: duration)
                    isPresented = false
                }
            }
        #endif
    }
}

extension View {
    /// Adds a hint: a native tooltip on macOS, a touch-and-hold bubble on touch platforms.
    public func aedstTooltip(_ text: String, duration: Duration = .seconds(3)) -> some View {
        modifier(AedstTooltipModifier(text, duration: duration))
    }
}

#Preview("AedstTooltip") {
    HStack(spacing: AedstSpacing.lg) {
        AedstIconButton(systemImage: "plus", accessibilityLabel: "Add", variant: .outline) {}
            .aedstTooltip("Add to library")
        AedstButton("Hover or hold", variant: .secondary, fillsWidth: false) {}
            .aedstTooltip("Tooltips repeat what the control does.")
    }
    .padding()
}

#endif
