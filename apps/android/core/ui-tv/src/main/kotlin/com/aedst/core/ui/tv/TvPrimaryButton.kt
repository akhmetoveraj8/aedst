package com.aedst.core.ui.tv

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import androidx.tv.material3.Border
import androidx.tv.material3.Button
import androidx.tv.material3.ButtonDefaults
import androidx.tv.material3.ButtonScale
import androidx.tv.material3.Text
import com.aedst.core.ui.a11y.aedstMinTouchHeight
import com.aedst.core.ui.a11y.rememberReducedMotion
import com.aedst.core.ui.theme.AedstShapesScale
import com.aedst.core.ui.theme.AedstSpacing
import com.aedst.core.ui.theme.AedstTheme
import androidx.tv.material3.MaterialTheme as TvMaterialTheme

/**
 * D-pad-focusable primary action control for 10-foot UI, activated by the centre / Enter key. The focused button
 * shows a [FOCUS_RING] outline in the high-contrast `onSurface` colour (not scale and colour alone, which are easy to
 * miss on a TV), is at least 48dp tall, and does not grow when the system "remove animations" setting is on.
 * Thin wrapper around
 * [androidx.tv.material3.Button] — the same "wrap the platform primitive,
 * don't reinvent it" approach `core.ui`'s `AedstButton` takes for Material3.
 *
 * Not a fork of [com.aedst.core.ui.components.AedstButton]: `tv-material3`'s
 * `Button` has its own focus/scale animation contract that Material3's
 * `Button` does not expose, so the two genuinely diverge (see this module's
 * README).
 */
@Composable
fun TvPrimaryButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true) {
    val ringColor = TvMaterialTheme.colorScheme.onSurface
    Button(
        onClick = onClick,
        modifier = modifier.aedstMinTouchHeight(),
        enabled = enabled,
        scale = if (rememberReducedMotion()) ButtonScale.None else ButtonDefaults.scale(),
        border = ButtonDefaults.border(
            focusedBorder = Border(BorderStroke(FOCUS_RING, ringColor), shape = AedstShapesScale.medium),
        ),
        shape = ButtonDefaults.shape(AedstShapesScale.medium),
        contentPadding = PaddingValues(horizontal = AedstSpacing.xxl, vertical = AedstSpacing.md),
        colors = ButtonDefaults.colors(
            containerColor = TvMaterialTheme.colorScheme.primary,
            contentColor = TvMaterialTheme.colorScheme.onPrimary,
        ),
    ) {
        Text(text)
    }
}

private val FOCUS_RING = AedstSpacing.xs

@Preview(name = "TV", widthDp = 400, heightDp = 200)
@Composable
private fun TvPrimaryButtonPreview() {
    AedstTheme {
        TvPrimaryButton(text = "Continue", onClick = {})
    }
}
