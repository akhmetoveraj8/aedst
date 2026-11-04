package com.aedst.android

import android.content.res.Configuration
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import com.aedst.core.ui.components.AedstButton
import com.aedst.core.ui.components.AedstButtonVariant
import com.aedst.core.ui.screens.PlayStoreLinks
import com.aedst.core.ui.theme.AedstSpacing
import com.aedst.core.ui.theme.AedstTheme

/**
 * Non-blocking prompt for `UPDATE_STATUS_RECOMMENDED` (ADR-0009): the server still accepts this build, so the user
 * may dismiss it for the rest of the process. The blocking case is `UpgradeRequiredScreen`.
 */
@Composable
fun UpdateRecommendedBanner(onDismiss: () -> Unit, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    Row(
        modifier = modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.secondaryContainer)
            .windowInsetsPadding(WindowInsets.statusBars)
            .padding(horizontal = AedstSpacing.md, vertical = AedstSpacing.xs)
            .semantics { liveRegion = LiveRegionMode.Polite },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(AedstSpacing.xs),
    ) {
        Text(
            text = stringResource(R.string.update_recommended),
            style = MaterialTheme.typography.labelLarge,
            color = MaterialTheme.colorScheme.onSecondaryContainer,
            modifier = Modifier.weight(1f),
        )
        AedstButton(
            text = stringResource(R.string.update_recommended_action),
            onClick = { PlayStoreLinks.open(context) },
            variant = AedstButtonVariant.GHOST,
        )
        AedstButton(
            text = stringResource(R.string.update_recommended_later),
            onClick = onDismiss,
            variant = AedstButtonVariant.GHOST,
        )
    }
}

@Preview(name = "Light", showBackground = true)
@Preview(name = "Dark", uiMode = Configuration.UI_MODE_NIGHT_YES, showBackground = true)
@Composable
private fun UpdateRecommendedBannerPreview() {
    AedstTheme {
        UpdateRecommendedBanner(onDismiss = {})
    }
}
