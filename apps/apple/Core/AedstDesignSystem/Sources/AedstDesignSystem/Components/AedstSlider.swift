import SwiftUI

/// Tokenized wrapper of the native `Slider`, matching shadcn/ui `Slider`. The native control already provides
/// the adjustable accessibility trait, increment/decrement actions, keyboard support on macOS and mirroring in
/// right-to-left layouts. tvOS and watchOS have no `Slider`: there the same API draws a progress bar between a
/// minus and a plus button (focus-driven, and adjustable for VoiceOver), see `AedstSliderLogic`.
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
                .tint(isDisabled ? AedstColor.mutedForeground : AedstColor.primary)
                .aedstDisabled(isDisabled)
                .aedstScaledMinFrame(minHeight: AedstHitTarget.minimum)
                .aedstHaptic(.selection, trigger: step == nil ? 0 : value)
                .accessibilityLabel(Text(label))
                .accessibilityValue(Text(valueText ?? value.formatted()))
        }
    }

    @ViewBuilder private var slider: some View {
        #if os(tvOS) || os(watchOS)
        HStack(spacing: AedstSpacing.sm) {
            Button { value = AedstSliderLogic.moved(value, by: -1, in: range, step: step) } label: {
                Image(systemName: "minus")
            }
            .accessibilityLabel(Text(AedstStrings.decrease))
            ProgressView(value: AedstSliderLogic.clamped(value, to: range) - range.lowerBound, total: range.upperBound - range.lowerBound)
                .accessibilityHidden(true)
            Button { value = AedstSliderLogic.moved(value, by: 1, in: range, step: step) } label: {
                Image(systemName: "plus")
            }
            .accessibilityLabel(Text(AedstStrings.increase))
        }
        .buttonStyle(AedstPressableButtonStyle(cornerRadius: AedstRadius.md))
        .accessibilityElement(children: .ignore)
        .accessibilityAdjustableAction { direction in
            switch direction {
            case .increment: value = AedstSliderLogic.moved(value, by: 1, in: range, step: step)
            case .decrement: value = AedstSliderLogic.moved(value, by: -1, in: range, step: step)
            @unknown default: break
            }
        }
        #else
        if let step {
            Slider(value: $value, in: range, step: step)
        } else {
            Slider(value: $value, in: range)
        }
        #endif
    }
}

/// Arithmetic of the slider fallback for platforms without `Slider` (tvOS, watchOS); pure, so it is unit-tested
/// on every platform.
enum AedstSliderLogic {
    /// Without an explicit step the fallback moves in tenths of the range.
    static let defaultStepCount = 10.0

    static func clamped(_ value: Double, to range: ClosedRange<Double>) -> Double {
        min(max(value, range.lowerBound), range.upperBound)
    }

    /// `value` moved one step (`direction` is +1 or -1) and kept inside `range`. With a step the result lands on
    /// a multiple of it, counted from the lower bound.
    static func moved(_ value: Double, by direction: Int, in range: ClosedRange<Double>, step: Double?) -> Double {
        let size = (step.flatMap { $0 > 0 ? $0 : nil }) ?? (range.upperBound - range.lowerBound) / defaultStepCount
        guard size > 0 else { return clamped(value, to: range) }
        let steps = ((clamped(value, to: range) - range.lowerBound) / size).rounded() + Double(direction.signum())
        return clamped(range.lowerBound + steps * size, to: range)
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
