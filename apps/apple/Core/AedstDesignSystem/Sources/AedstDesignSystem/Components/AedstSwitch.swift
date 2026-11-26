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

    /// Thumb diameter: the track height minus a 1 pt inset on each side.
    var thumb: CGFloat { track.height - 2 }

    /// How far the thumb travels from off to on.
    var travel: CGFloat { track.width - track.height }
}

/// The kit's switch drawing (web track and thumb, token colors), keeping `Toggle`'s own semantics: VoiceOver reads
/// it as a switch with its on/off value, and the thumb slides to the trailing edge, mirrored in right-to-left.
struct AedstSwitchToggleStyle: ToggleStyle {
    let size: AedstSwitchSize
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: AedstSpacing.sm) {
            configuration.label
            Spacer(minLength: AedstSpacing.none)
            Capsule()
                .fill(configuration.isOn ? AedstColor.primary : AedstColor.input)
                .frame(width: size.track.width, height: size.track.height)
                .overlay(alignment: .leading) {
                    Circle()
                        .fill(AedstColor.background)
                        .frame(width: size.thumb, height: size.thumb)
                        .padding(.leading, 1)
                        .offset(x: configuration.isOn ? size.travel : 0)
                }
                .aedstAnimation(.easeOut(duration: AedstMotion.durationFast), value: configuration.isOn)
                .aedstHitTarget()
                .contentShape(Rectangle())
                .onTapGesture { configuration.isOn.toggle() }
        }
        .opacity(isEnabled ? 1 : 0.5)
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
        .disabled(isDisabled)
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
