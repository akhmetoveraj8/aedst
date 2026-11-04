package com.aedst.core.ui.components

import android.content.res.Configuration
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.tooling.preview.Preview
import com.aedst.core.ui.theme.AedstSpacing
import com.aedst.core.ui.theme.AedstTheme

/**
 * Form field label, mirroring web's `label.tsx`. Appends a `*` in
 * [MaterialTheme.colorScheme.error] when [required] so required fields read consistently across
 * forms without callers building the asterisk themselves.
 */
@Composable
fun AedstLabel(text: String, modifier: Modifier = Modifier, required: Boolean = false) {
    val errorColor = MaterialTheme.colorScheme.error
    val content = if (required) {
        buildAnnotatedString {
            append(text)
            append(' ')
            withStyle(SpanStyle(color = errorColor)) { append('*') }
        }
    } else {
        buildAnnotatedString { append(text) }
    }
    Text(
        text = content,
        modifier = modifier,
        style = MaterialTheme.typography.labelLarge,
        color = MaterialTheme.colorScheme.onSurface,
    )
}

@Preview(name = "Light")
@Preview(name = "Dark", uiMode = Configuration.UI_MODE_NIGHT_YES)
@Composable
private fun AedstLabelPreview() {
    AedstTheme {
        Surface(color = MaterialTheme.colorScheme.background) {
            androidx.compose.foundation.layout.Column(
                modifier = Modifier.padding(AedstSpacing.lg),
                verticalArrangement = androidx.compose.foundation.layout.Arrangement.spacedBy(AedstSpacing.sm),
            ) {
                AedstLabel(text = "Full name", required = true)
                AedstLabel(text = "Middle name")
            }
        }
    }
}
