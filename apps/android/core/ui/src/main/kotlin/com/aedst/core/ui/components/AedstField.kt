package com.aedst.core.ui.components

import android.content.res.Configuration
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.movableContentOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.error
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.aedst.core.ui.theme.AedstSpacing
import com.aedst.core.ui.theme.AedstTheme

/** Layout of an [AedstField], mirroring web's `field.tsx` `orientation` prop. */
enum class AedstFieldOrientation {
    /** Label and help text above the control. */
    VERTICAL,

    /** Label and help text at the start, the control at the end (switches, checkboxes). */
    HORIZONTAL,

    /** [HORIZONTAL] when the field is at least 600dp wide, otherwise [VERTICAL]. */
    RESPONSIVE,
}

/**
 * One labelled form row: label, optional description, the control and an error message, mirroring web's `field.tsx`.
 * The [error] replaces nothing: it is added under the description, is announced as it appears (polite live region)
 * and marks the field invalid for accessibility services. Pass the same error state to the control itself.
 */
@Composable
fun AedstField(
    label: String,
    modifier: Modifier = Modifier,
    description: String? = null,
    error: String? = null,
    required: Boolean = false,
    orientation: AedstFieldOrientation = AedstFieldOrientation.VERTICAL,
    content: @Composable () -> Unit,
) {
    // One movable slot for both layouts: the control keeps its state when RESPONSIVE flips.
    val control = remember(content) { movableContentOf(content) }
    val fieldModifier = modifier.fillMaxWidth().semantics { if (error != null) this.error(error) }
    val texts: @Composable (Modifier) -> Unit = { textModifier ->
        Column(modifier = textModifier, verticalArrangement = Arrangement.spacedBy(AedstSpacing.xxs)) {
            AedstLabel(text = label, required = required)
            if (description != null) {
                Text(
                    text = description,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (error != null) {
                Text(
                    text = error,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error,
                    modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                )
            }
        }
    }
    BoxWithConstraints(modifier = fieldModifier) {
        val horizontal = when (orientation) {
            AedstFieldOrientation.VERTICAL -> false
            AedstFieldOrientation.HORIZONTAL -> true
            AedstFieldOrientation.RESPONSIVE -> maxWidth >= RESPONSIVE_BREAKPOINT
        }
        if (horizontal) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(AedstSpacing.lg),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                texts(Modifier.weight(1f))
                control()
            }
        } else {
            Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(AedstSpacing.sm)) {
                texts(Modifier)
                control()
            }
        }
    }
}

private val RESPONSIVE_BREAKPOINT = 600.dp

@Preview(name = "Light", showBackground = true)
@Preview(name = "Dark", uiMode = Configuration.UI_MODE_NIGHT_YES, showBackground = true)
@Composable
private fun AedstFieldPreview() {
    AedstTheme {
        Surface {
            Column(
                modifier = Modifier.padding(AedstSpacing.lg),
                verticalArrangement = Arrangement.spacedBy(AedstSpacing.lg),
            ) {
                AedstField(label = "Email", description = "Used for sign-in.", error = "Enter a valid email") {
                    AedstTextField(value = "ada@", onValueChange = {}, isError = true)
                }
                AedstField(label = "Notifications", orientation = AedstFieldOrientation.HORIZONTAL) {
                    AedstSwitch(checked = true, onCheckedChange = {}, label = "Notifications")
                }
            }
        }
    }
}
