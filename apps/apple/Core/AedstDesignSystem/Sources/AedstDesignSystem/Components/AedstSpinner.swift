import SwiftUI

/// Indeterminate activity indicator matching shadcn/ui `Spinner`: the system `ProgressView`, tinted with the
/// current foreground token. The system indicator already honours Reduce Motion. For progress with a value use
/// `AedstProgressView`.
public struct AedstSpinner: View {
    private let label: String?
    private let controlSize: ControlSize
    private let tint: Color

    /// - Parameters:
    ///   - label: Accessibility label; `nil` announces the localized "Loading".
    ///   - controlSize: System control size (`.mini` ... `.extraLarge`); the indicator scales with Dynamic Type.
    ///   - tint: Colour token of the indicator.
    public init(
        label: String? = nil,
        controlSize: ControlSize = .regular,
        tint: Color = AedstColor.mutedForeground
    ) {
        self.label = label
        self.controlSize = controlSize
        self.tint = tint
    }

    public var body: some View {
        ProgressView()
            .progressViewStyle(.circular)
            .controlSize(controlSize)
            .tint(tint)
            .accessibilityLabel(Text(label ?? AedstStrings.loading))
    }
}

#Preview("AedstSpinner") {
    HStack(spacing: AedstSpacing.lg) {
        AedstSpinner(controlSize: .small)
        AedstSpinner()
        AedstSpinner(label: "Saving", controlSize: .large, tint: AedstColor.primary)
    }
    .padding()
}
