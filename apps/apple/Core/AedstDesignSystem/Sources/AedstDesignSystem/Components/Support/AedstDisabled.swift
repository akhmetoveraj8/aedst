import SwiftUI

/// The kit's disabled treatment: token colours instead of a half-transparent copy of the enabled colours, which
/// drops text and borders below WCAG contrast (a 0.5 opacity text on a muted fill is under 4.5:1). A disabled
/// control keeps its layout, shows its text in `mutedForeground`, its border in `input`, its fill in `muted`
/// and its active mark (a check, a dot, a thumb) in `mutedForeground`.
///
/// Each control passes its enabled colour and its own `isDisabled`; views nested inside a control read
/// `@Environment(\.isEnabled)` (set by `.aedstDisabled`) instead. System controls that cannot be recoloured
/// (`DatePicker`, `Slider`, `Menu`) keep the system's own disabled drawing: `.aedstDisabled` only disables them.
enum AedstDisabledStyle {
    /// Text and icons.
    static func foreground(_ normal: Color, isDisabled: Bool) -> Color {
        isDisabled ? AedstColor.mutedForeground : normal
    }

    /// Outlines of an input or a choice box.
    static func border(_ normal: Color, isDisabled: Bool) -> Color {
        isDisabled ? AedstColor.input : normal
    }

    /// Surfaces of an input or a selected row.
    static func fill(_ normal: Color, isDisabled: Bool) -> Color {
        isDisabled ? AedstColor.muted : normal
    }

    /// A selected mark drawn in `primary` when enabled (checkbox box, radio dot, switch track).
    static func mark(_ normal: Color, isDisabled: Bool) -> Color {
        isDisabled ? AedstColor.mutedForeground : normal
    }

    /// Text drawn on top of `mark` (the check inside a filled box): readable on `mutedForeground`.
    static func onMark(_ normal: Color, isDisabled: Bool) -> Color {
        isDisabled ? AedstColor.muted : normal
    }
}

extension View {
    /// Disables the control (`disabled`, so SwiftUI adds the "dimmed" VoiceOver trait and blocks input) and
    /// replaces the old `opacity(0.5)`: the colours come from `AedstDisabledStyle`, applied by the control.
    func aedstDisabled(_ isDisabled: Bool) -> some View {
        disabled(isDisabled)
    }
}
