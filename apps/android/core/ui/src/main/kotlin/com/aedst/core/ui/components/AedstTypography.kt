package com.aedst.core.ui.components

import android.content.res.Configuration
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import com.aedst.core.ui.theme.AedstShapesScale
import com.aedst.core.ui.theme.AedstSpacing
import com.aedst.core.ui.theme.AedstTheme

/** Text style of [AedstTypography], mirroring web's `typography.tsx` `variant` prop. */
enum class AedstTypographyVariant {
    H1,
    H2,
    H3,
    H4,
    P,
    BLOCKQUOTE,

    /** Bulleted list: every line of the text is one item. */
    LIST,
    INLINE_CODE,
    LEAD,
    LARGE,
    SMALL,
    MUTED,
}

@Composable
@ReadOnlyComposable
private fun styleFor(variant: AedstTypographyVariant): TextStyle {
    val typography = MaterialTheme.typography
    return when (variant) {
        AedstTypographyVariant.H1 -> typography.displayLarge
        AedstTypographyVariant.H2 -> typography.headlineLarge
        AedstTypographyVariant.H3 -> typography.headlineMedium
        AedstTypographyVariant.H4 -> typography.titleLarge
        AedstTypographyVariant.P, AedstTypographyVariant.LIST -> typography.bodyLarge
        AedstTypographyVariant.BLOCKQUOTE -> typography.bodyLarge.copy(fontStyle = FontStyle.Italic)
        AedstTypographyVariant.INLINE_CODE -> typography.bodyMedium.copy(
            fontFamily = FontFamily.Monospace,
            fontWeight = FontWeight.SemiBold,
        )
        AedstTypographyVariant.LEAD -> typography.titleLarge.copy(fontWeight = FontWeight.Normal)
        AedstTypographyVariant.LARGE -> typography.titleMedium.copy(fontWeight = FontWeight.SemiBold)
        AedstTypographyVariant.SMALL -> typography.labelLarge
        AedstTypographyVariant.MUTED -> typography.bodyMedium
    }
}

private val headings = setOf(
    AedstTypographyVariant.H1,
    AedstTypographyVariant.H2,
    AedstTypographyVariant.H3,
    AedstTypographyVariant.H4,
)

private val mutedVariants = setOf(AedstTypographyVariant.LEAD, AedstTypographyVariant.MUTED)

/**
 * The prose text styles as one component, mirroring web's `typography.tsx`. Headings are announced as headings;
 * [AedstTypographyVariant.H2] carries the bottom rule, [AedstTypographyVariant.BLOCKQUOTE] the start-side rule.
 */
@Composable
fun AedstTypography(
    text: String,
    modifier: Modifier = Modifier,
    variant: AedstTypographyVariant = AedstTypographyVariant.P,
) {
    val style = styleFor(variant)
    val color = if (variant in mutedVariants) {
        MaterialTheme.colorScheme.onSurfaceVariant
    } else {
        MaterialTheme.colorScheme.onSurface
    }
    when (variant) {
        AedstTypographyVariant.H2 -> Column(modifier = modifier.fillMaxWidth()) {
            Text(text, style = style, color = color, modifier = Modifier.semantics { heading() })
            AedstDivider(modifier = Modifier.padding(top = AedstSpacing.sm))
        }

        AedstTypographyVariant.BLOCKQUOTE -> Row(modifier = modifier.height(IntrinsicSize.Min)) {
            AedstDivider(orientation = AedstDividerOrientation.VERTICAL)
            Text(text, style = style, color = color, modifier = Modifier.padding(start = AedstSpacing.xxl))
        }

        AedstTypographyVariant.LIST -> Column(
            modifier = modifier.padding(start = AedstSpacing.xxl),
            verticalArrangement = Arrangement.spacedBy(AedstSpacing.sm),
        ) {
            text.lines().filter { it.isNotBlank() }.forEach { line ->
                Row(horizontalArrangement = Arrangement.spacedBy(AedstSpacing.sm)) {
                    Text(BULLET, style = style, color = color)
                    Text(line.trim(), style = style, color = color)
                }
            }
        }

        AedstTypographyVariant.INLINE_CODE -> Text(
            text = text,
            style = style,
            color = color,
            modifier = modifier
                .background(MaterialTheme.colorScheme.surfaceVariant, AedstShapesScale.small)
                .padding(horizontal = AedstSpacing.xs, vertical = AedstSpacing.xxs),
        )

        else -> Text(
            text = text,
            style = style,
            color = color,
            modifier = if (variant in headings) modifier.semantics { heading() } else modifier,
        )
    }
}

private const val BULLET = "•"

@Preview(name = "Light", showBackground = true)
@Preview(name = "Dark", uiMode = Configuration.UI_MODE_NIGHT_YES, showBackground = true)
@Composable
private fun AedstTypographyPreview() {
    AedstTheme {
        Surface {
            Column(
                modifier = Modifier.padding(AedstSpacing.lg),
                verticalArrangement = Arrangement.spacedBy(AedstSpacing.sm),
            ) {
                AedstTypographyVariant.entries.forEach { variant ->
                    AedstTypography(
                        text = if (variant == AedstTypographyVariant.LIST) "First\nSecond" else variant.name,
                        variant = variant,
                    )
                }
            }
        }
    }
}
