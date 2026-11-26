package com.aedst.core.ui.components

import android.content.res.Configuration
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.isTraversalGroup
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import com.aedst.core.ui.theme.AedstSpacing
import com.aedst.core.ui.theme.AedstTheme

/**
 * Horizontal row of [AedstAiSuggestion]s above the prompt input (web `AiSuggestions`, shadcn AI Elements
 * "Suggestion"). It scrolls sideways when the suggestions do not fit and is one traversal group (web `role="group"`).
 */
@Composable
fun AedstAiSuggestions(modifier: Modifier = Modifier, content: @Composable RowScope.() -> Unit) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .semantics { isTraversalGroup = true }
            .horizontalScroll(rememberScrollState())
            .padding(vertical = AedstSpacing.xs),
        horizontalArrangement = Arrangement.spacedBy(AedstSpacing.sm),
        verticalAlignment = Alignment.CenterVertically,
        content = content,
    )
}

/**
 * A prompt the person sends in one tap (web `AiSuggestion`): an outline small button. [onClick] receives
 * [suggestion]; [text] is the visible label and accessible name when it should differ from the prompt.
 */
@Composable
fun AedstAiSuggestion(
    suggestion: String,
    onClick: (String) -> Unit,
    modifier: Modifier = Modifier,
    text: String = suggestion,
    enabled: Boolean = true,
) {
    AedstButton(
        text = text,
        onClick = { onClick(suggestion) },
        modifier = modifier,
        variant = AedstButtonVariant.OUTLINE,
        size = AedstButtonSize.SM,
        enabled = enabled,
    )
}

@Preview(name = "Light", showBackground = true)
@Preview(name = "Dark", uiMode = Configuration.UI_MODE_NIGHT_YES, showBackground = true)
@Composable
private fun AedstAiSuggestionPreview() {
    AedstTheme {
        Surface {
            AedstAiSuggestions(modifier = Modifier.padding(AedstSpacing.lg)) {
                AedstAiSuggestion("Summarize this thread", onClick = {})
                AedstAiSuggestion("Draft a reply", onClick = {})
                AedstAiSuggestion("Find open tasks", onClick = {})
            }
        }
    }
}
