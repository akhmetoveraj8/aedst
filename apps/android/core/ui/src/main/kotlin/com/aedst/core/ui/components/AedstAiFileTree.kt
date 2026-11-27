package com.aedst.core.ui.components

import android.content.res.Configuration
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.selection.selectable
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.outlined.InsertDriveFile
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material.icons.outlined.FolderOpen
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Stable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.LayoutDirection
import com.aedst.core.ui.a11y.rememberDisclosureEnter
import com.aedst.core.ui.a11y.rememberDisclosureExit
import com.aedst.core.ui.components.support.AI_LINE_ICON_SIZE
import com.aedst.core.ui.components.support.AiFileTreeState
import com.aedst.core.ui.components.support.aiDisclosureStateText
import com.aedst.core.ui.components.support.aiDisclosureToggle
import com.aedst.core.ui.components.support.chevronRotation
import com.aedst.core.ui.components.support.inlineStartRule
import com.aedst.core.ui.components.support.rememberAiFileTreeState
import com.aedst.core.ui.theme.AedstShapesScale
import com.aedst.core.ui.theme.AedstSpacing
import com.aedst.core.ui.theme.AedstTheme

/**
 * Receiver of an [AedstAiFileTree]'s content: carries the tree's open folders and selection, which
 * [AedstAiFileTreeFolder] and [AedstAiFileTreeFile] (extensions on this scope) read explicitly. Rows nested in a
 * folder reach the same scope, since a folder's content runs inside the tree's.
 */
@Stable
sealed class AedstAiFileTreeScope {
    internal abstract val tree: AiFileTreeState
}

private class AiFileTreeScopeImpl(override val tree: AiFileTreeState) : AedstAiFileTreeScope()

/**
 * The files the agent changed, as folders that open and close (web `ai-file-tree.tsx`). A folder is a disclosure
 * button, a file a selectable button; both are 48dp rows reached in order with D-pad / Tab. Open folders are
 * controlled by [expanded] when set, otherwise remembered from [defaultExpanded]; [selectedPath] marks the selected
 * file. Meant for the handful of files one agent turn touches: the tree is not lazy.
 */
@Composable
fun AedstAiFileTree(
    modifier: Modifier = Modifier,
    expanded: Set<String>? = null,
    defaultExpanded: Set<String> = emptySet(),
    onExpandedChange: ((Set<String>) -> Unit)? = null,
    selectedPath: String? = null,
    onSelect: ((String) -> Unit)? = null,
    content: @Composable AedstAiFileTreeScope.() -> Unit,
) {
    val state = rememberAiFileTreeState(expanded, defaultExpanded, onExpandedChange, selectedPath, onSelect)
    val scope = remember(state) { AiFileTreeScopeImpl(state) }
    Column(modifier = modifier.fillMaxWidth()) { scope.content() }
}

/** A folder at [path] showing [name]; [content] holds its children, indented under an inline-start rule. */
@Composable
fun AedstAiFileTreeScope.AedstAiFileTreeFolder(
    path: String,
    name: String,
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    val isOpen = tree.isExpanded(path)
    val stateText = aiDisclosureStateText(isOpen, statusLabel = null)
    Column(modifier = modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clip(AedstShapesScale.medium)
                .aiDisclosureToggle(isOpen, stateText) { tree.toggle(path, it) }
                .heightIn(min = AedstSpacing.massive)
                .padding(horizontal = AedstSpacing.sm),
            horizontalArrangement = Arrangement.spacedBy(AedstSpacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                imageVector = Icons.AutoMirrored.Filled.KeyboardArrowRight,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier
                    .size(AI_LINE_ICON_SIZE)
                    .rotate(chevronRotation(isOpen, LocalLayoutDirection.current)),
            )
            AedstAiFileTreeIcon(if (isOpen) Icons.Outlined.FolderOpen else Icons.Outlined.Folder)
            AedstAiFileTreeName(name, modifier = Modifier.weight(1f, fill = false))
        }
        AnimatedVisibility(visible = isOpen, enter = rememberDisclosureEnter(), exit = rememberDisclosureExit()) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(start = AedstSpacing.lg)
                    .inlineStartRule(MaterialTheme.colorScheme.outlineVariant)
                    .padding(start = AedstSpacing.xs),
                content = content,
            )
        }
    }
}

/**
 * A file at [path] showing [name]: a selectable row (selected state exposed, accent background) that calls the tree's
 * `onSelect`. [actions] sit next to the row, never inside it (a badge, a menu).
 */
@Composable
fun AedstAiFileTreeScope.AedstAiFileTreeFile(
    path: String,
    name: String,
    modifier: Modifier = Modifier,
    icon: ImageVector = Icons.AutoMirrored.Outlined.InsertDriveFile,
    actions: (@Composable RowScope.() -> Unit)? = null,
) {
    val isSelected = tree.selectedPath == path
    val colors = MaterialTheme.colorScheme
    Row(
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(AedstSpacing.xs),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Row(
            modifier = Modifier
                .weight(1f)
                .clip(AedstShapesScale.medium)
                .background(if (isSelected) colors.secondaryContainer else Color.Transparent)
                .selectable(selected = isSelected, role = Role.Button) { tree.select(path) }
                .heightIn(min = AedstSpacing.massive)
                // Aligns with folder names, which have a chevron before the icon.
                .padding(start = FILE_INDENT, end = AedstSpacing.sm),
            horizontalArrangement = Arrangement.spacedBy(AedstSpacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            AedstAiFileTreeIcon(icon)
            AedstAiFileTreeName(name, modifier = Modifier.weight(1f, fill = false))
        }
        if (actions != null) AedstAiFileTreeActions(content = actions)
    }
}

/** Decorative 16dp muted icon of a file or folder row. */
@Composable
fun AedstAiFileTreeIcon(icon: ImageVector, modifier: Modifier = Modifier) {
    Icon(
        imageVector = icon,
        contentDescription = null,
        tint = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = modifier.size(AI_LINE_ICON_SIZE),
    )
}

/** A file or folder name: mono, truncated, laid out left to right (a path) also in RTL. */
@Composable
fun AedstAiFileTreeName(name: String, modifier: Modifier = Modifier) {
    CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Ltr) {
        Text(
            text = name,
            style = MaterialTheme.typography.labelMedium,
            fontFamily = FontFamily.Monospace,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = modifier,
        )
    }
}

@Composable
fun AedstAiFileTreeActions(modifier: Modifier = Modifier, content: @Composable RowScope.() -> Unit) {
    Row(
        modifier = modifier,
        horizontalArrangement = Arrangement.spacedBy(AedstSpacing.xs),
        verticalAlignment = Alignment.CenterVertically,
        content = content,
    )
}

/** Chevron (16dp) plus the row gap, so file icons line up with folder icons (web `ps-7`). */
private val FILE_INDENT = AedstSpacing.sm + AI_LINE_ICON_SIZE + AedstSpacing.sm

@Preview(name = "Light", showBackground = true)
@Preview(name = "Dark", uiMode = Configuration.UI_MODE_NIGHT_YES, showBackground = true)
@Preview(name = "RTL", locale = "ar", showBackground = true)
@Composable
private fun AedstAiFileTreePreview() {
    AedstTheme {
        Surface {
            AedstAiFileTree(defaultExpanded = setOf("src"), selectedPath = "src/button.tsx", onSelect = {}) {
                AedstAiFileTreeFolder(path = "src", name = "src") {
                    AedstAiFileTreeFile(path = "src/button.tsx", name = "button.tsx") {
                        AedstBadge(text = "M", variant = AedstBadgeVariant.SECONDARY)
                    }
                    AedstAiFileTreeFile(path = "src/card.tsx", name = "card.tsx")
                }
                AedstAiFileTreeFile(path = "package.json", name = "package.json")
            }
        }
    }
}
