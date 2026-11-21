package com.aedst.core.ui.components

import android.content.res.Configuration
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.aedst.core.ui.R
import com.aedst.core.ui.theme.AedstSpacing
import com.aedst.core.ui.theme.AedstTheme

/**
 * Small inline busy indicator, mirroring web's `spinner.tsx`: 16dp, drawn in the current content colour so it sits
 * inside buttons and rows. For a progress value or a page-level loader use `AedstCircularProgressIndicator`.
 */
@Composable
fun AedstSpinner(
    modifier: Modifier = Modifier,
    contentDescription: String = stringResource(R.string.aedst_a11y_loading),
) {
    CircularProgressIndicator(
        modifier = modifier
            .size(16.dp)
            .semantics { this.contentDescription = contentDescription },
        strokeWidth = 2.dp,
        color = LocalContentColor.current,
    )
}

@Preview(name = "Light", showBackground = true)
@Preview(name = "Dark", uiMode = Configuration.UI_MODE_NIGHT_YES, showBackground = true)
@Composable
private fun AedstSpinnerPreview() {
    AedstTheme {
        Surface { AedstSpinner(modifier = Modifier.padding(AedstSpacing.lg)) }
    }
}
