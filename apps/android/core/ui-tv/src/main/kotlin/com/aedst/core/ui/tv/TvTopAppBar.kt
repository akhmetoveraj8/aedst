package com.aedst.core.ui.tv

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import androidx.tv.material3.Surface
import androidx.tv.material3.Text
import com.aedst.core.ui.theme.AedstSpacing
import com.aedst.core.ui.theme.AedstTheme
import androidx.tv.material3.MaterialTheme as TvMaterialTheme

/**
 * 10-foot-UI header bar. `tv-material3` has no `TopAppBar` composable of its
 * own (unlike Material3) — the row/padding layout below is genuinely custom,
 * but every visual primitive it's built from ([Surface], [Text]) is a
 * `tv-material3` component so focus/overscan behave the TV-idiomatic way.
 * Not a duplicate of `core.ui`'s [com.aedst.core.ui.components.AedstTopAppBar],
 * which wraps Material3's phone-oriented `TopAppBar` — see this module's README.
 */
@Composable
fun TvTopAppBar(title: String, modifier: Modifier = Modifier, actions: @Composable RowScope.() -> Unit = {}) {
    Surface(modifier = modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = AedstSpacing.xxl, vertical = AedstSpacing.lg),
            horizontalArrangement = Arrangement.spacedBy(AedstSpacing.md),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = title,
                style = TvMaterialTheme.typography.headlineSmall,
                modifier = Modifier.padding(end = AedstSpacing.md),
            )
            Row(
                horizontalArrangement = Arrangement.spacedBy(AedstSpacing.sm),
                verticalAlignment = Alignment.CenterVertically,
                content = actions,
            )
        }
    }
}

@Preview(name = "TV", widthDp = 960, heightDp = 120)
@Composable
private fun TvTopAppBarPreview() {
    AedstTheme {
        TvTopAppBar(title = "AEDST")
    }
}
