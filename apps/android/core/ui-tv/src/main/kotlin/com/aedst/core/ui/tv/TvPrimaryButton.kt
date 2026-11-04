package com.aedst.core.ui.tv

import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import androidx.tv.material3.Button
import androidx.tv.material3.ButtonDefaults
import androidx.tv.material3.Text
import com.aedst.core.ui.theme.AedstSpacing
import com.aedst.core.ui.theme.AedstTheme
import androidx.tv.material3.MaterialTheme as TvMaterialTheme

/**
 * D-pad-focusable primary action control for 10-foot UI. Thin wrapper around
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
    Button(
        onClick = onClick,
        modifier = modifier,
        enabled = enabled,
        contentPadding = PaddingValues(horizontal = AedstSpacing.xxl, vertical = AedstSpacing.md),
        colors = ButtonDefaults.colors(
            containerColor = TvMaterialTheme.colorScheme.primary,
            contentColor = TvMaterialTheme.colorScheme.onPrimary,
        ),
    ) {
        Text(text)
    }
}

@Preview(name = "TV", widthDp = 400, heightDp = 200)
@Composable
private fun TvPrimaryButtonPreview() {
    AedstTheme {
        TvPrimaryButton(text = "Continue", onClick = {})
    }
}
