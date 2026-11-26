package com.aedst.core.ui.theme

import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color

/**
 * Tokens that Material3's [androidx.compose.material3.ColorScheme] has no slot for, but web's
 * token set defines: chart series colors, the sidebar surface family and the code syntax colors
 * (`syntax*`, used by [com.aedst.core.ui.components.AedstCodeBlock]).
 */
@Immutable
data class AedstExtendedColors(
    val chart1: Color,
    val chart2: Color,
    val chart3: Color,
    val chart4: Color,
    val chart5: Color,
    val sidebar: Color,
    val sidebarForeground: Color,
    val sidebarPrimary: Color,
    val sidebarPrimaryForeground: Color,
    val sidebarAccent: Color,
    val sidebarAccentForeground: Color,
    val sidebarBorder: Color,
    val sidebarRing: Color,
    val syntaxComment: Color,
    val syntaxKeyword: Color,
    val syntaxString: Color,
    val syntaxNumber: Color,
    val syntaxFunction: Color,
    val syntaxType: Color,
    val syntaxPunctuation: Color,
) {
    val chartColors: List<Color> get() = listOf(chart1, chart2, chart3, chart4, chart5)
}

val AedstLightExtendedColors = AedstExtendedColors(
    chart1 = AedstLightPalette.chart1,
    chart2 = AedstLightPalette.chart2,
    chart3 = AedstLightPalette.chart3,
    chart4 = AedstLightPalette.chart4,
    chart5 = AedstLightPalette.chart5,
    sidebar = AedstLightPalette.sidebar,
    sidebarForeground = AedstLightPalette.sidebarForeground,
    sidebarPrimary = AedstLightPalette.sidebarPrimary,
    sidebarPrimaryForeground = AedstLightPalette.sidebarPrimaryForeground,
    sidebarAccent = AedstLightPalette.sidebarAccent,
    sidebarAccentForeground = AedstLightPalette.sidebarAccentForeground,
    sidebarBorder = AedstLightPalette.sidebarBorder,
    sidebarRing = AedstLightPalette.sidebarRing,
    syntaxComment = AedstLightPalette.syntaxComment,
    syntaxKeyword = AedstLightPalette.syntaxKeyword,
    syntaxString = AedstLightPalette.syntaxString,
    syntaxNumber = AedstLightPalette.syntaxNumber,
    syntaxFunction = AedstLightPalette.syntaxFunction,
    syntaxType = AedstLightPalette.syntaxType,
    syntaxPunctuation = AedstLightPalette.syntaxPunctuation,
)

val AedstDarkExtendedColors = AedstExtendedColors(
    chart1 = AedstDarkPalette.chart1,
    chart2 = AedstDarkPalette.chart2,
    chart3 = AedstDarkPalette.chart3,
    chart4 = AedstDarkPalette.chart4,
    chart5 = AedstDarkPalette.chart5,
    sidebar = AedstDarkPalette.sidebar,
    sidebarForeground = AedstDarkPalette.sidebarForeground,
    sidebarPrimary = AedstDarkPalette.sidebarPrimary,
    sidebarPrimaryForeground = AedstDarkPalette.sidebarPrimaryForeground,
    sidebarAccent = AedstDarkPalette.sidebarAccent,
    sidebarAccentForeground = AedstDarkPalette.sidebarAccentForeground,
    sidebarBorder = AedstDarkPalette.sidebarBorder,
    sidebarRing = AedstDarkPalette.sidebarRing,
    syntaxComment = AedstDarkPalette.syntaxComment,
    syntaxKeyword = AedstDarkPalette.syntaxKeyword,
    syntaxString = AedstDarkPalette.syntaxString,
    syntaxNumber = AedstDarkPalette.syntaxNumber,
    syntaxFunction = AedstDarkPalette.syntaxFunction,
    syntaxType = AedstDarkPalette.syntaxType,
    syntaxPunctuation = AedstDarkPalette.syntaxPunctuation,
)

val LocalAedstExtendedColors = staticCompositionLocalOf { AedstLightExtendedColors }

/**
 * Whether the dark palette is active, as chosen by [AedstTheme] (which may be forced independently of the system
 * setting). Components that pick palette tokens read this, never `isSystemInDarkTheme()`.
 */
val LocalAedstDarkTheme = staticCompositionLocalOf { false }
