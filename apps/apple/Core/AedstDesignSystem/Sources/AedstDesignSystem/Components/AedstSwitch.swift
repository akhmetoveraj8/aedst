import SwiftUI

/// shadcn/ui `Switch` `size`: the track and thumb of web (`default` 32 x 18 pt with a 16 pt thumb, `sm` 24 x 14 pt
/// with a 12 pt thumb). The tappable area stays at least 44 x 44 pt on touch platforms for both.
public enum AedstSwitchSize: Sendable, CaseIterable {
    case `default`
    case sm

    /// Track size.
    var track: CGSize {
        switch self {
        case .default: CGSize(width: 32, height: 18)
        case .sm: CGSize(width: 24, height: 14)
        }
    }

    /// Gap between the track edge and the thumb.
    static let thumbInset: CGFloat = 1

    /// Thumb diameter: the track height minus the inset on each side.
    var thumb: CGFloat { track.height - 2 * Self.thumbInset }

    /// How far the thumb travels from off to on.
    var travel: CGFloat { track.width - track.height }
}

/// The kit's switch drawing (web track and thumb, token colors), keeping `Toggle`'s own semantics: VoiceOver reads
/// it as a switch with its on/off value. The thumb is placed by alignment (leading when off, trailing when on),
/// not by a physical `.offset(x:)`, so it mirrors by itself in right-to-left layouts. The track and thumb scale
/// with Dynamic Type; the tappable area stays at least 44 x 44 pt on touch platforms.
struct AedstSwitchToggleStyle: ToggleStyle {
    let size: AedstSwitchSize
    @Environment(\.isEnabled) private var isEnabled
    @ScaledMetric(relativeTo: .body) private var scale: CGFloat = 1

    func makeBody(configuration: Configuration) -> some View {
        let track = CGSize(width: size.track.width * scale, height: size.track.height * scale)
        let thumb = size.thumb * scale
        HStack(spacing: AedstSpacing.sm) {
            configuration.label
                .foregroundStyle(AedstDisabledStyle.foreground(AedstColor.foreground, isDisabled: !isEnabled))
            Spacer(minLength: AedstSpacing.none)
            Capsule()
                .fill(configuration.isOn ? AedstDisabledStyle.mark(AedstColor.primary, isDisabled: !isEnabled) : AedstColor.input)
                .frame(width: track.width, height: track.height)
                .overlay {
                    Circle()
                        .fill(AedstColor.background)
                        .frame(width: thumb, height: thumb)
                        .padding(AedstSwitchSize.thumbInset)
                        .frame(maxWidth: .infinity, alignment: configuration.isOn ? .trailing : .leading)
                }
                .modifier(AedstFocusRing(cornerRadius: track.height / 2))
                .aedstAnimation(.easeOut(duration: AedstMotion.durationFast), value: configuration.isOn)
                .aedstHitTarget()
                .contentShape(Rectangle())
                .onTapGesture { configuration.isOn.toggle() }
                .aedstHaptic(.selection, trigger: configuration.isOn)
        }
    }
}

/// On/off control matching shadcn/ui `Switch` (`size` default/sm) — use for settings that apply immediately.
public struct AedstSwitch: View {
    private let label: String?
    @Binding private var isOn: Bool
    private let size: AedstSwitchSize
    private let isDisabled: Bool

    public init(_ label: String? = nil, isOn: Binding<Bool>, size: AedstSwitchSize = .default, isDisabled: Bool = false) {
        self.label = label
        self._isOn = isOn
        self.size = size
        self.isDisabled = isDisabled
    }

    public var body: some View {
        Toggle(isOn: $isOn) {
            if let label {
                Text(label)
                    .font(AedstTypography.body)
            }
        }
        .toggleStyle(AedstSwitchToggleStyle(size: size))
        .aedstDisabled(isDisabled)
        .accessibilityLabel(Text(label ?? AedstStrings.switchControl))
    }
}

#Preview("AedstSwitch") {
    VStack(alignment: .leading, spacing: AedstSpacing.sm) {
        AedstSwitch("Enable notifications", isOn: .constant(true))
        AedstSwitch("Airplane mode", isOn: .constant(false))
        AedstSwitch("Compact", isOn: .constant(true), size: .sm)
        AedstSwitch("Disabled", isOn: .constant(true), isDisabled: true)
    }
    .padding()
}
