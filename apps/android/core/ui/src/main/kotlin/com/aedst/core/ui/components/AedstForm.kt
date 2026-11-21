package com.aedst.core.ui.components

import android.content.res.Configuration
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import com.aedst.core.ui.theme.AedstSpacing
import com.aedst.core.ui.theme.AedstTheme

/**
 * Vertical form layout, mirroring web's `form.tsx` (there a styled `<form>`): stacks [AedstField]s and the submit
 * row with the form spacing. Compose has no form element, so submission, validation and draft state stay in the
 * screen's ViewModel (see the ViewModel contract); wire the last field's IME action to the same submit intent as
 * the button.
 */
@Composable
fun AedstForm(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(AedstSpacing.lg),
        content = content,
    )
}

@Preview(name = "Light", showBackground = true)
@Preview(name = "Dark", uiMode = Configuration.UI_MODE_NIGHT_YES, showBackground = true)
@Composable
private fun AedstFormPreview() {
    AedstTheme {
        Surface {
            AedstForm(modifier = Modifier.padding(AedstSpacing.lg)) {
                AedstField(label = "Title", required = true) {
                    AedstTextField(value = "Release plan", onValueChange = {})
                }
                AedstField(label = "Notes") {
                    AedstTextArea(value = "", onValueChange = {})
                }
                AedstButton(text = "Save", onClick = {})
            }
        }
    }
}
