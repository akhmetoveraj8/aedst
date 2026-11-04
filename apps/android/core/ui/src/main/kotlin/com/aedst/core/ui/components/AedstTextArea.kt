package com.aedst.core.ui.components

import android.content.res.Configuration
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.disabled
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import com.aedst.core.ui.theme.AedstShapesScale
import com.aedst.core.ui.theme.AedstSpacing
import com.aedst.core.ui.theme.AedstTheme

/**
 * Multi-line text input wrapping Material3 [OutlinedTextField], mirroring web's `textarea.tsx`.
 * Defaults to a taller, non-single-line field bounded by [minLines]/[maxLines].
 */
@Composable
fun AedstTextArea(
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    label: String? = null,
    placeholder: String? = null,
    supportingText: String? = null,
    isError: Boolean = false,
    enabled: Boolean = true,
    readOnly: Boolean = false,
    minLines: Int = 3,
    maxLines: Int = 6,
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default,
) {
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        modifier = modifier.fillMaxWidth().semantics { if (!enabled) disabled() },
        enabled = enabled,
        readOnly = readOnly,
        label = label?.let { { Text(it) } },
        placeholder = placeholder?.let { { Text(it) } },
        supportingText = supportingText?.let { { Text(it) } },
        isError = isError,
        keyboardOptions = keyboardOptions,
        singleLine = false,
        minLines = minLines,
        maxLines = maxLines,
        shape = AedstShapesScale.medium,
    )
}

@Preview(name = "Light")
@Preview(name = "Dark", uiMode = Configuration.UI_MODE_NIGHT_YES)
@Composable
private fun AedstTextAreaPreview() {
    AedstTheme {
        Surface(color = MaterialTheme.colorScheme.background) {
            AedstTextArea(
                value = "Notes about this task go here.",
                onValueChange = {},
                modifier = Modifier.padding(AedstSpacing.lg),
                label = "Notes",
                placeholder = "Write something…",
            )
        }
    }
}
