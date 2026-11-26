package com.aedst.core.ui.components

import android.content.res.Configuration
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.aedst.core.ui.R
import com.aedst.core.ui.theme.AedstSpacing
import com.aedst.core.ui.theme.AedstTheme
import androidx.compose.ui.semantics.heading as markAsHeading

/**
 * Receiver of an [AedstAiModelSelector]'s menu content: lets an [AedstAiModelSelectorItem] (an extension on this
 * scope) close the menu after a pick, handed over explicitly instead of through a CompositionLocal.
 */
@Stable
sealed class AedstAiModelSelectorScope {
    internal abstract fun close()
}

private class AiModelSelectorScopeImpl(private val onClose: () -> Unit) : AedstAiModelSelectorScope() {
    override fun close() = onClose()
}

/** A scope whose items call [onClose]; internal so the component catalog and previews can render items alone. */
internal fun aiModelSelectorScope(onClose: () -> Unit): AedstAiModelSelectorScope = AiModelSelectorScopeImpl(onClose)

/**
 * Picks the model (or effort) the agent runs with, mirroring web's `AiModelSelector` + `AiModelSelectorContent`
 * (shadcn AI Elements "Model Selector"): a [trigger] ([AedstAiModelSelectorTrigger]) and a menu of radio items.
 * State is hoisted: the trigger toggles [expanded], a pick or an outside tap closes it. Put
 * [AedstAiModelSelectorList] (one radio group) with [AedstAiModelSelectorGroup]s and [AedstAiModelSelectorItem]s
 * in [content]. Built on the Material 3 menu because [AedstDropdownMenu] is a flat action list with no radio
 * selection or group headings.
 */
@Composable
fun AedstAiModelSelector(
    expanded: Boolean,
    onExpandedChange: (Boolean) -> Unit,
    trigger: @Composable () -> Unit,
    modifier: Modifier = Modifier,
    content: @Composable AedstAiModelSelectorScope.() -> Unit,
) {
    val change by rememberUpdatedState(onExpandedChange)
    val scope = remember { aiModelSelectorScope { change(false) } }
    Box(modifier = modifier) {
        trigger()
        DropdownMenu(expanded = expanded, onDismissRequest = { onExpandedChange(false) }) { scope.content() }
    }
}

/**
 * The current model's [name] with a chevron, a small ghost button for the prompt input footer (web
 * `AiModelSelectorTrigger`). It exposes the expanded / collapsed state and the drop-down role; [label] (e.g.
 * "Model") is read before the name when set.
 */
@Composable
fun AedstAiModelSelectorTrigger(
    name: String,
    expanded: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    label: String? = null,
    logo: (@Composable () -> Unit)? = null,
) {
    val state = stringResource(if (expanded) R.string.aedst_a11y_expanded else R.string.aedst_a11y_collapsed)
    AedstButton(
        text = name,
        onClick = onClick,
        modifier = modifier.semantics {
            role = Role.DropdownList
            stateDescription = state
            if (label != null) contentDescription = "$label: $name"
        },
        variant = AedstButtonVariant.GHOST,
        size = AedstButtonSize.SM,
        leadingIcon = if (logo != null) {
            { logo() }
        } else {
            null
        },
        trailingIcon = {
            Icon(
                imageVector = Icons.Default.KeyboardArrowDown,
                contentDescription = null,
                modifier = Modifier.size(14.dp), // web size-3.5
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        },
    )
}

/** The radio group that holds the selected model (web `AiModelSelectorList`). */
@Composable
fun AedstAiModelSelectorList(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Column(modifier = modifier.selectableGroup(), content = content)
}

/** Models of one provider under a visible [heading] (web `AiModelSelectorGroup`). */
@Composable
fun AedstAiModelSelectorGroup(
    modifier: Modifier = Modifier,
    heading: String? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(modifier = modifier) {
        if (heading != null) {
            Text(
                text = heading,
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier
                    .padding(horizontal = AedstSpacing.md, vertical = AedstSpacing.xs)
                    .semantics { markAsHeading() },
            )
        }
        content()
    }
}

/**
 * One model, a radio item (web `AiModelSelectorItem`): [selected] shows a check and is exposed as the selected
 * state; picking it calls [onSelect] and closes the menu. [shortcut] is a hint such as "⌘1".
 */
@Composable
fun AedstAiModelSelectorScope.AedstAiModelSelectorItem(
    name: String,
    selected: Boolean,
    onSelect: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    logo: (@Composable () -> Unit)? = null,
    shortcut: String? = null,
) {
    DropdownMenuItem(
        text = { AedstAiModelSelectorName(name) },
        onClick = {
            onSelect()
            close()
        },
        modifier = modifier.semantics {
            role = Role.RadioButton
            this.selected = selected
        },
        leadingIcon = logo,
        trailingIcon = if (selected || shortcut != null) {
            {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(AedstSpacing.sm),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    if (shortcut != null) AedstAiModelSelectorShortcut(shortcut)
                    if (selected) Icon(Icons.Default.Check, contentDescription = null)
                }
            }
        } else {
            null
        },
        enabled = enabled,
    )
}

/** Divider between groups (web `AiModelSelectorSeparator`). */
@Composable
fun AedstAiModelSelectorSeparator(modifier: Modifier = Modifier) {
    AedstDivider(modifier = modifier.padding(vertical = AedstSpacing.xs))
}

/** Muted keyboard hint at the end of an item (web `AiModelSelectorShortcut`). */
@Composable
fun AedstAiModelSelectorShortcut(text: String, modifier: Modifier = Modifier) {
    Text(
        text = text,
        modifier = modifier,
        style = MaterialTheme.typography.labelSmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
}

/** Decorative 16dp slot for a provider logo the app supplies; nothing is fetched (web `AiModelSelectorLogo`). */
@Composable
fun AedstAiModelSelectorLogo(modifier: Modifier = Modifier, content: @Composable BoxScope.() -> Unit) {
    Box(
        modifier = modifier.size(16.dp).clearAndSetSemantics {}, // web size-4
        contentAlignment = Alignment.Center,
        content = content,
    )
}

/** Overlapping row of logos, e.g. the providers that serve one model (web `AiModelSelectorLogoGroup`). */
@Composable
fun AedstAiModelSelectorLogoGroup(modifier: Modifier = Modifier, content: @Composable RowScope.() -> Unit) {
    Row(
        modifier = modifier,
        horizontalArrangement = Arrangement.spacedBy(-AedstSpacing.xs),
        verticalAlignment = Alignment.CenterVertically,
        content = content,
    )
}

/** The model name, one line, ellipsized (web `AiModelSelectorName`). */
@Composable
fun AedstAiModelSelectorName(text: String, modifier: Modifier = Modifier) {
    Text(text = text, modifier = modifier, maxLines = 1, overflow = TextOverflow.Ellipsis)
}

@Preview(name = "Light", showBackground = true)
@Preview(name = "Dark", uiMode = Configuration.UI_MODE_NIGHT_YES, showBackground = true)
@Composable
private fun AedstAiModelSelectorPreview() {
    AedstTheme {
        Surface {
            Column(modifier = Modifier.padding(AedstSpacing.lg)) {
                AedstAiModelSelectorTrigger(name = "Fast model", expanded = false, onClick = {})
                with(aiModelSelectorScope {}) {
                    AedstAiModelSelectorList {
                        AedstAiModelSelectorGroup(heading = "Provider") {
                            AedstAiModelSelectorItem(name = "Fast model", selected = true, onSelect = {
                            }, shortcut = "1")
                            AedstAiModelSelectorItem(name = "Large model", selected = false, onSelect = {})
                        }
                        AedstAiModelSelectorSeparator()
                    }
                }
            }
        }
    }
}
