import SwiftUI
#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

/// Semantic color tokens, one adaptive `Color` per name — the Swift
/// counterpart to the Compose `MaterialTheme.colorScheme` wiring in
/// `apps/android/core/ui` and the CSS custom properties in
/// `apps/web/src/app/styles/globals.css`. Backed by dynamic light/dark
/// initializers rather than an asset catalog; swap for `Color("primary", bundle: .module)`
/// backed by `Resources/Colors.xcassets` if designers want to own these via
/// Figma tokens instead.
///
/// Values come from the generated `AedstLightPalette`/`AedstDarkPalette` (single source:
/// `packages/design-tokens/tokens/color`); this file only pairs them into adaptive colors.
///
/// Names and pairing mirror web's token set 1:1 (`background`/`foreground`,
/// `primary`/`primaryForeground`, ...) so a design spec reads the same
/// token name on every platform.
public enum AedstColor {
    public static let background = adaptive(light: AedstLightPalette.background, dark: AedstDarkPalette.background)
    public static let foreground = adaptive(light: AedstLightPalette.foreground, dark: AedstDarkPalette.foreground)

    public static let card = adaptive(light: AedstLightPalette.card, dark: AedstDarkPalette.card)
    public static let cardForeground = adaptive(light: AedstLightPalette.cardForeground, dark: AedstDarkPalette.cardForeground)

    public static let popover = adaptive(light: AedstLightPalette.popover, dark: AedstDarkPalette.popover)
    public static let popoverForeground = adaptive(light: AedstLightPalette.popoverForeground, dark: AedstDarkPalette.popoverForeground)

    public static let primary = adaptive(light: AedstLightPalette.primary, dark: AedstDarkPalette.primary)
    public static let primaryForeground = adaptive(light: AedstLightPalette.primaryForeground, dark: AedstDarkPalette.primaryForeground)

    public static let secondary = adaptive(light: AedstLightPalette.secondary, dark: AedstDarkPalette.secondary)
    public static let secondaryForeground = adaptive(light: AedstLightPalette.secondaryForeground, dark: AedstDarkPalette.secondaryForeground)

    public static let muted = adaptive(light: AedstLightPalette.muted, dark: AedstDarkPalette.muted)
    public static let mutedForeground = adaptive(light: AedstLightPalette.mutedForeground, dark: AedstDarkPalette.mutedForeground)

    public static let accent = adaptive(light: AedstLightPalette.accent, dark: AedstDarkPalette.accent)
    public static let accentForeground = adaptive(light: AedstLightPalette.accentForeground, dark: AedstDarkPalette.accentForeground)

    public static let destructive = adaptive(light: AedstLightPalette.destructive, dark: AedstDarkPalette.destructive)
    public static let destructiveForeground = adaptive(light: AedstLightPalette.destructiveForeground, dark: AedstDarkPalette.destructiveForeground)

    public static let success = adaptive(light: AedstLightPalette.success, dark: AedstDarkPalette.success)
    public static let successForeground = adaptive(light: AedstLightPalette.successForeground, dark: AedstDarkPalette.successForeground)

    public static let warning = adaptive(light: AedstLightPalette.warning, dark: AedstDarkPalette.warning)
    public static let warningForeground = adaptive(light: AedstLightPalette.warningForeground, dark: AedstDarkPalette.warningForeground)

    public static let border = adaptive(light: AedstLightPalette.border, dark: AedstDarkPalette.border)
    public static let input = adaptive(light: AedstLightPalette.input, dark: AedstDarkPalette.input)
    public static let ring = adaptive(light: AedstLightPalette.ring, dark: AedstDarkPalette.ring)

    public static let chart1 = adaptive(light: AedstLightPalette.chart1, dark: AedstDarkPalette.chart1)
    public static let chart2 = adaptive(light: AedstLightPalette.chart2, dark: AedstDarkPalette.chart2)
    public static let chart3 = adaptive(light: AedstLightPalette.chart3, dark: AedstDarkPalette.chart3)
    public static let chart4 = adaptive(light: AedstLightPalette.chart4, dark: AedstDarkPalette.chart4)
    public static let chart5 = adaptive(light: AedstLightPalette.chart5, dark: AedstDarkPalette.chart5)

    /// Ordered palette for chart series that need to cycle through colors.
    public static let chartSeries: [Color] = [chart1, chart2, chart3, chart4, chart5]

    // MARK: - Legacy aliases (kept for `AedstButton`/`AedstTextField` call sites during migration)

    @available(*, deprecated, renamed: "primary")
    public static let brandPrimary = primary
    @available(*, deprecated, renamed: "accent")
    public static let brandSecondary = accent
    @available(*, deprecated, renamed: "muted")
    public static let surface = muted
    @available(*, deprecated, renamed: "foreground")
    public static let textPrimary = foreground
    @available(*, deprecated, renamed: "mutedForeground")
    public static let textSecondary = mutedForeground
    @available(*, deprecated, renamed: "destructive")
    public static let danger = destructive

    private static func adaptive(light: Color, dark: Color) -> Color {
        Color(light: light, dark: dark)
    }
}

extension Color {
    /// `UITraitCollection`/`NSAppearance`-driven light/dark pair, so a single
    /// token works unmodified on iOS, macOS, watchOS and tvOS.
    init(light: Color, dark: Color) {
        #if canImport(UIKit)
        self = Color(uiColor: UIColor { traits in
            traits.userInterfaceStyle == .dark ? UIColor(dark) : UIColor(light)
        })
        #elseif canImport(AppKit)
        self = Color(nsColor: NSColor(name: nil) { appearance in
            appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? NSColor(dark) : NSColor(light)
        })
        #else
        self = light
        #endif
    }
}
