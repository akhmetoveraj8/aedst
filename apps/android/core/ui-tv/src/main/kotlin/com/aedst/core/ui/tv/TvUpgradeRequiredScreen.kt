package com.aedst.core.ui.tv

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import androidx.tv.material3.Text
import com.aedst.core.ui.R
import com.aedst.core.ui.screens.PlayStoreLinks
import com.aedst.core.ui.theme.AedstSpacing
import com.aedst.core.ui.theme.AedstTheme
import androidx.tv.material3.MaterialTheme as TvMaterialTheme

/**
 * 10-foot counterpart of `core:ui`'s `UpgradeRequiredScreen` for `CLIENT_UPGRADE_REQUIRED` (ADR-0009). The server
 * refuses this build, so nothing else is reachable. The only control takes focus when the screen appears, so a single
 * D-pad centre press starts the update without first having to find the button; the copy is shared with the phone
 * screen (`core:ui` strings), so all five locales stay in one place.
 */
@Composable
fun TvUpgradeRequiredScreen(modifier: Modifier = Modifier, onUpdate: () -> Unit = {}) {
    val context = LocalContext.current
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { focus.requestFocus() }

    Column(
        modifier = modifier
            .fillMaxSize()
            // Overscan-safe margins: TVs may crop the outer few percent of the picture.
            .padding(horizontal = AedstSpacing.giant, vertical = AedstSpacing.massive),
        verticalArrangement = Arrangement.spacedBy(AedstSpacing.xl, Alignment.CenterVertically),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            text = stringResource(R.string.aedst_upgrade_title),
            style = TvMaterialTheme.typography.displaySmall,
            textAlign = TextAlign.Center,
            modifier = Modifier.semantics { heading() },
        )
        Text(
            text = stringResource(R.string.aedst_upgrade_body),
            style = TvMaterialTheme.typography.bodyLarge,
            textAlign = TextAlign.Center,
        )
        TvPrimaryButton(
            text = stringResource(R.string.aedst_upgrade_action),
            onClick = {
                onUpdate()
                PlayStoreLinks.open(context)
            },
            modifier = Modifier.focusRequester(focus),
        )
    }
}

@Preview(name = "TV", widthDp = 960, heightDp = 540)
@Composable
private fun TvUpgradeRequiredScreenPreview() {
    AedstTheme {
        TvUpgradeRequiredScreen()
    }
}
