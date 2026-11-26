package com.aedst.core.ui.components.support

import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.State
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.listSaver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue

/**
 * Open folders and selection of an `AedstAiFileTree` (web `FileTreeContext`), handed to its rows through the tree's
 * `AedstAiFileTreeScope`. Every getter reads snapshot state, so a
 * folder or file row recomposes only when its own answer changes; the object is stable for the tree's lifetime.
 */
@Stable
internal class AiFileTreeState(
    private val expanded: State<Set<String>>,
    private val onToggle: State<(String, Boolean) -> Unit>,
    private val selected: State<String?>,
    private val onSelect: State<((String) -> Unit)?>,
) {
    val selectedPath: String? get() = selected.value

    fun isExpanded(path: String): Boolean = path in expanded.value

    fun toggle(path: String, open: Boolean) = onToggle.value(path, open)

    fun select(path: String) {
        onSelect.value?.invoke(path)
    }
}

private val PathSetSaver = listSaver<Set<String>, String>(save = { it.toList() }, restore = { it.toSet() })

/** Controlled ([expanded]) or uncontrolled ([defaultExpanded], saved across configuration changes) open folders. */
@Composable
internal fun rememberAiFileTreeState(
    expanded: Set<String>?,
    defaultExpanded: Set<String>,
    onExpandedChange: ((Set<String>) -> Unit)?,
    selectedPath: String?,
    onSelect: ((String) -> Unit)?,
): AiFileTreeState {
    var inner by rememberSaveable(stateSaver = PathSetSaver) { mutableStateOf(defaultExpanded) }
    val current = rememberUpdatedState(expanded ?: inner)
    val onToggle: (String, Boolean) -> Unit = { path, open ->
        val next = if (open) current.value + path else current.value - path
        inner = next
        onExpandedChange?.invoke(next)
    }
    val toggle = rememberUpdatedState(onToggle)
    val selected = rememberUpdatedState(selectedPath)
    val select = rememberUpdatedState(onSelect)
    return remember { AiFileTreeState(current, toggle, selected, select) }
}
