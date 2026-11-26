package com.aedst.core.ui.components.support

import androidx.compose.foundation.clickable
import androidx.compose.runtime.Composable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.State
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import com.aedst.core.ui.R

/**
 * Open state of one AI Elements disclosure (web: the `Collapsible` behind `AiChainOfThought`), handed to the header and
 * content parts through the line's `AedstAiDisclosureScope`. [isExpanded] reads a snapshot state, so only the parts
 * that read it recompose when it changes; the object itself is stable for the lifetime of the container.
 */
@Stable
internal class AiDisclosure(private val expanded: State<Boolean>, private val onChange: State<(Boolean) -> Unit>) {
    val isExpanded: Boolean get() = expanded.value

    fun setExpanded(value: Boolean) = onChange.value(value)
}

/**
 * Controlled-or-uncontrolled open state (web `open` / `defaultOpen` / `onOpenChange`): [expanded] wins when set,
 * otherwise the user's last choice (saved across configuration changes), otherwise [fallback] (e.g. "open while
 * streaming").
 */
@Composable
internal fun rememberAiDisclosure(
    expanded: Boolean?,
    defaultExpanded: Boolean?,
    fallback: Boolean,
    onExpandedChange: ((Boolean) -> Unit)?,
): AiDisclosure {
    var chosen by rememberSaveable { mutableStateOf(defaultExpanded) }
    val current = rememberUpdatedState(expanded ?: chosen ?: fallback)
    val onChange: (Boolean) -> Unit = { next ->
        chosen = next
        onExpandedChange?.invoke(next)
    }
    val change = rememberUpdatedState(onChange)
    return remember { AiDisclosure(current, change) }
}

/**
 * State description of a disclosure button: the optional [statusLabel] then "Expanded" / "Collapsed" (web: visually
 * hidden status text plus `aria-expanded`).
 */
@Composable
@ReadOnlyComposable
internal fun aiDisclosureStateText(isExpanded: Boolean, statusLabel: String?): String {
    val state = stringResource(if (isExpanded) R.string.aedst_a11y_expanded else R.string.aedst_a11y_collapsed)
    return listOfNotNull(statusLabel, state).joinToString(", ")
}

/** Makes a row the disclosure button: role Button, a click toggles, [stateText] from [aiDisclosureStateText]. */
internal fun Modifier.aiDisclosureToggle(
    isExpanded: Boolean,
    stateText: String,
    onToggle: (Boolean) -> Unit,
): Modifier = clickable(role = Role.Button) { onToggle(!isExpanded) }.semantics { stateDescription = stateText }

/** The inline-start rule of an indented panel (web `border-s`), on the right in RTL. */
internal fun Modifier.inlineStartRule(color: Color): Modifier = drawBehind {
    val width = RULE_WIDTH.toPx()
    val x = if (layoutDirection == LayoutDirection.Rtl) size.width - width / 2 else width / 2
    drawLine(color, Offset(x, 0f), Offset(x, size.height), width)
}

/** Chevron rotation of a disclosure: right (mirrored in RTL) when closed, down when open. */
internal fun chevronRotation(isExpanded: Boolean, layoutDirection: LayoutDirection): Float = when {
    !isExpanded -> 0f
    // The auto-mirrored arrow points left in RTL, so it turns the other way to point down.
    layoutDirection == LayoutDirection.Rtl -> -QUARTER_TURN
    else -> QUARTER_TURN
}

private const val QUARTER_TURN = 90f
private val RULE_WIDTH = 1.dp // allow-dp: hairline rule, web border-s
