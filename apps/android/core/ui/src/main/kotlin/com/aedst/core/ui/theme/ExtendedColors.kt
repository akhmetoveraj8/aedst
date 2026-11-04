package com.aedst.core.ui.theme

import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color

/**
 * Tokens that Material3's [androidx.compose.material3.ColorScheme] has no slot for, but web's
 * token set defines: chart series colors and the sidebar surface family.
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
)

val LocalAedstExtendedColors = staticCompositionLocalOf { AedstLightExtendedColors }

/**
 * Whether the dark palette is active, as chosen by [AedstTheme] (which may be forced independently of the system
 * setting). Components that pick palette tokens read this, never `isSystemInDarkTheme()`.
 */
val LocalAedstDarkTheme = staticCompositionLocalOf { false }
