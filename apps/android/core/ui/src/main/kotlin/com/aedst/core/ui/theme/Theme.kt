package com.aedst.core.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.ReadOnlyComposable

private val LightColors = lightColorScheme(
    background = AedstLightPalette.background,
    onBackground = AedstLightPalette.foreground,
    surface = AedstLightPalette.card,
    onSurface = AedstLightPalette.cardForeground,
    surfaceVariant = AedstLightPalette.muted,
    onSurfaceVariant = AedstLightPalette.mutedForeground,
    surfaceTint = AedstLightPalette.primary,
    inverseSurface = AedstDarkPalette.card,
    inverseOnSurface = AedstDarkPalette.cardForeground,
    primary = AedstLightPalette.primary,
    onPrimary = AedstLightPalette.primaryForeground,
    primaryContainer = AedstLightPalette.accent,
    onPrimaryContainer = AedstLightPalette.accentForeground,
    secondary = AedstLightPalette.secondary,
    onSecondary = AedstLightPalette.secondaryForeground,
    tertiary = AedstLightPalette.accent,
    onTertiary = AedstLightPalette.accentForeground,
    error = AedstLightPalette.destructive,
    onError = AedstLightPalette.destructiveForeground,
    outline = AedstLightPalette.input,
    outlineVariant = AedstLightPalette.border,
)

private val DarkColors = darkColorScheme(
    background = AedstDarkPalette.background,
    onBackground = AedstDarkPalette.foreground,
    surface = AedstDarkPalette.card,
    onSurface = AedstDarkPalette.cardForeground,
    surfaceVariant = AedstDarkPalette.muted,
    onSurfaceVariant = AedstDarkPalette.mutedForeground,
    surfaceTint = AedstDarkPalette.primary,
    inverseSurface = AedstLightPalette.card,
    inverseOnSurface = AedstLightPalette.cardForeground,
    primary = AedstDarkPalette.primary,
    onPrimary = AedstDarkPalette.primaryForeground,
    primaryContainer = AedstDarkPalette.accent,
    onPrimaryContainer = AedstDarkPalette.accentForeground,
    secondary = AedstDarkPalette.secondary,
    onSecondary = AedstDarkPalette.secondaryForeground,
    tertiary = AedstDarkPalette.accent,
    onTertiary = AedstDarkPalette.accentForeground,
    error = AedstDarkPalette.destructive,
    onError = AedstDarkPalette.destructiveForeground,
    outline = AedstDarkPalette.input,
    outlineVariant = AedstDarkPalette.border,
)

/**
 * Root theme for every `core.ui` component. Wraps [MaterialTheme] with the AEDST semantic color
 * scheme, typography and shapes, and exposes [LocalAedstExtendedColors] for chart/sidebar tokens
 * that Material3's [androidx.compose.material3.ColorScheme] has no slot for.
 */
@Composable
fun AedstTheme(useDarkTheme: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    val colorScheme = if (useDarkTheme) DarkColors else LightColors
    val extendedColors = if (useDarkTheme) AedstDarkExtendedColors else AedstLightExtendedColors

    CompositionLocalProvider(
        LocalAedstExtendedColors provides extendedColors,
        LocalAedstDarkTheme provides useDarkTheme,
    ) {
        MaterialTheme(
            colorScheme = colorScheme,
            typography = AedstTypography,
            shapes = AedstShapes,
            content = content,
        )
    }
}

/** Convenience accessor: `AedstTheme.extendedColors` from inside any `@Composable`. */
object AedstThemeExtras {
    val extendedColors: AedstExtendedColors
        @Composable
        @ReadOnlyComposable
        get() = LocalAedstExtendedColors.current
}
