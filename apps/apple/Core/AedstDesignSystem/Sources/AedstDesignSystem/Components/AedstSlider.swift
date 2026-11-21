import SwiftUI

// iOS, macOS and visionOS only: tvOS and watchOS are scaffolded package platforms without app targets
// (`Slider` does not exist on tvOS).
#if os(iOS) || os(macOS) || os(visionOS)

/// Tokenized wrapper of the native `Slider`, matching shadcn/ui `Slider`. The native control already provides
/// the adjustable accessibility trait, increment/decrement actions, keyboard support on macOS and mirroring in
/// right-to-left layouts.
public struct AedstSlider: View {
    private let label: String
    @Binding private var value: Double
    private let range: ClosedRange<Double>
    private let step: Double?
    private let valueText: String?
    private let showsLabel: Bool
    private let isDisabled: Bool

    /// - Parameters:
    ///   - label: Already localized name of the value ("Volume"); always the accessibility label.
    ///   - step: Distance between valid values; `nil` is continuous.
    ///   - valueText: Already formatted value ("40 %"), shown next to the label and read by VoiceOver
    ///     instead of the raw number.
    ///   - showsLabel: `false` hides the label row (the accessibility label stays).
    public init(
        _ label: String,
        value: Binding<Double>,
        in range: ClosedRange<Double> = 0...1,
        step: Double? = nil,
        valueText: String? = nil,
        showsLabel: Bool = true,
        isDisabled: Bool = false
    ) {
        self.label = label
        self._value = value
        self.range = range
        self.step = step
        self.valueText = valueText
        self.showsLabel = showsLabel
        self.isDisabled = isDisabled
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: AedstSpacing.xs) {
            if showsLabel {
                HStack(spacing: AedstSpacing.sm) {
                    AedstLabel(label)
                    Spacer(minLength: AedstSpacing.none)
                    if let valueText {
                        Text(valueText)
                            .font(AedstTypography.caption)
                            .monospacedDigit()
                            .foregroundStyle(AedstColor.mutedForeground)
                    }
                }
                .accessibilityHidden(true)
            }
            slider
                .tint(AedstColor.primary)
                .disabled(isDisabled)
                .opacity(isDisabled ? 0.5 : 1)
                .frame(minHeight: AedstHitTarget.minimum)
                .accessibilityLabel(Text(label))
                .accessibilityValue(Text(valueText ?? value.formatted()))
        }
    }

    @ViewBuilder private var slider: some View {
        if let step {
            Slider(value: $value, in: range, step: step)
        } else {
            Slider(value: $value, in: range)
        }
    }
}

#Preview("AedstSlider") {
    @Previewable @State var volume = 0.4
    @Previewable @State var rating = 3.0
    VStack(alignment: .leading, spacing: AedstSpacing.lg) {
        AedstSlider("Volume", value: $volume, valueText: volume.formatted(.percent.precision(.fractionLength(0))))
        AedstSlider("Rating", value: $rating, in: 1...5, step: 1, valueText: rating.formatted())
        AedstSlider("Disabled", value: .constant(0.5), isDisabled: true)
    }
    .padding()
}

#endif
