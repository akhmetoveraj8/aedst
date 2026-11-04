package com.aedst.core.ui.theme

import androidx.compose.material3.Typography
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.sp

// Line heights are generated as dimensions (Dp); text layout needs sp.
private fun Dp.toSp(): TextUnit = value.sp

private fun style(fontSize: TextUnit, lineHeight: Dp, fontWeight: Int) = TextStyle(
    fontWeight = FontWeight(fontWeight),
    fontSize = fontSize,
    lineHeight = lineHeight.toSp(),
)

/** Material3 typography built from the generated [AedstTypeScale] (tokens: packages/design-tokens). */
val AedstTypography = Typography(
    displayLarge = style(
        AedstTypeScale.displayLargeFontSize,
        AedstTypeScale.displayLargeLineHeight,
        AedstTypeScale.DISPLAY_LARGE_FONT_WEIGHT,
    ),
    displayMedium = style(
        AedstTypeScale.displayMediumFontSize,
        AedstTypeScale.displayMediumLineHeight,
        AedstTypeScale.DISPLAY_MEDIUM_FONT_WEIGHT,
    ),
    headlineLarge = style(
        AedstTypeScale.headlineLargeFontSize,
        AedstTypeScale.headlineLargeLineHeight,
        AedstTypeScale.HEADLINE_LARGE_FONT_WEIGHT,
    ),
    headlineMedium = style(
        AedstTypeScale.headlineMediumFontSize,
        AedstTypeScale.headlineMediumLineHeight,
        AedstTypeScale.HEADLINE_MEDIUM_FONT_WEIGHT,
    ),
    titleLarge = style(
        AedstTypeScale.titleLargeFontSize,
        AedstTypeScale.titleLargeLineHeight,
        AedstTypeScale.TITLE_LARGE_FONT_WEIGHT,
    ),
    titleMedium = style(
        AedstTypeScale.titleMediumFontSize,
        AedstTypeScale.titleMediumLineHeight,
        AedstTypeScale.TITLE_MEDIUM_FONT_WEIGHT,
    ),
    titleSmall = style(
        AedstTypeScale.titleSmallFontSize,
        AedstTypeScale.titleSmallLineHeight,
        AedstTypeScale.TITLE_SMALL_FONT_WEIGHT,
    ),
    bodyLarge = style(
        AedstTypeScale.bodyLargeFontSize,
        AedstTypeScale.bodyLargeLineHeight,
        AedstTypeScale.BODY_LARGE_FONT_WEIGHT,
    ),
    bodyMedium = style(
        AedstTypeScale.bodyMediumFontSize,
        AedstTypeScale.bodyMediumLineHeight,
        AedstTypeScale.BODY_MEDIUM_FONT_WEIGHT,
    ),
    bodySmall = style(
        AedstTypeScale.bodySmallFontSize,
        AedstTypeScale.bodySmallLineHeight,
        AedstTypeScale.BODY_SMALL_FONT_WEIGHT,
    ),
    labelLarge = style(
        AedstTypeScale.labelLargeFontSize,
        AedstTypeScale.labelLargeLineHeight,
        AedstTypeScale.LABEL_LARGE_FONT_WEIGHT,
    ),
    labelMedium = style(
        AedstTypeScale.labelMediumFontSize,
        AedstTypeScale.labelMediumLineHeight,
        AedstTypeScale.LABEL_MEDIUM_FONT_WEIGHT,
    ),
    labelSmall = style(
        AedstTypeScale.labelSmallFontSize,
        AedstTypeScale.labelSmallLineHeight,
        AedstTypeScale.LABEL_SMALL_FONT_WEIGHT,
    ),
)
