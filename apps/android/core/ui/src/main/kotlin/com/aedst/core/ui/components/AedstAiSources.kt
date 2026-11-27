package com.aedst.core.ui.components

import android.content.res.Configuration
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Public
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.NonRestartableComposable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import com.aedst.core.ui.R
import com.aedst.core.ui.a11y.aedstMinTouchHeight
import com.aedst.core.ui.components.support.citationHostname
import com.aedst.core.ui.components.support.isWebUrl
import com.aedst.core.ui.theme.AedstShapesScale
import com.aedst.core.ui.theme.AedstSpacing
import com.aedst.core.ui.theme.AedstTheme

/**
 * The links the agent used for a reply, a line that opens into a list, mirroring web's `AiSources` (shadcn AI
 * Elements "Sources"). Like web it is an [AedstAiChainOfThought]: put an [AedstAiSourcesTrigger] and an
 * [AedstAiSourcesContent] of [AedstAiSource]s in [content]. Expansion is uncontrolled ([defaultExpanded]) unless
 * [expanded] is set.
 */
@Composable
@NonRestartableComposable
fun AedstAiSources(
    modifier: Modifier = Modifier,
    expanded: Boolean? = null,
    defaultExpanded: Boolean = false,
    onExpandedChange: ((Boolean) -> Unit)? = null,
    content: @Composable AedstAiDisclosureScope.() -> Unit,
) {
    AedstAiChainOfThought(
        modifier = modifier,
        expanded = expanded,
        defaultExpanded = defaultExpanded,
        onExpandedChange = onExpandedChange,
        content = content,
    )
}

/** The line with the count, worded by the caller ("Used 3 sources") (web `AiSourcesTrigger`); a globe by default. */
@Composable
fun AedstAiDisclosureScope.AedstAiSourcesTrigger(
    title: String,
    modifier: Modifier = Modifier,
    icon: ImageVector = Icons.Default.Public,
) {
    AedstAiChainOfThoughtHeader(title = title, modifier = modifier, icon = icon)
}

/** Holds the [AedstAiSource] links as a list (web `AiSourcesContent`). */
@Composable
fun AedstAiDisclosureScope.AedstAiSourcesContent(
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    AedstAiChainOfThoughtContent(modifier = modifier) {
        Column(modifier = Modifier.fillMaxWidth(), content = content)
    }
}

/**
 * One source (web `AiSource`): a 48dp row with an optional [icon], the [title] (the host name of [href] when null,
 * kept left to right) and a decorative outward arrow (auto-mirrored in right-to-left layouts). It is named
 * "title, [newTabLabel]". A tap calls [onOpen]; by default only `http` / `https` links open, in the browser.
 */
@Composable
fun AedstAiSource(
    href: String,
    modifier: Modifier = Modifier,
    title: String? = null,
    newTabLabel: String = stringResource(R.string.aedst_a11y_opens_in_browser),
    icon: ImageVector? = null,
    onOpen: ((String) -> Unit)? = null,
) {
    val uriHandler = LocalUriHandler.current
    val text = title ?: "⁦${citationHostname(href)}⁩" // isolate: a host name stays LTR in RTL text
    val name = stringResource(R.string.aedst_a11y_name_hint, text, newTabLabel)
    Row(
        modifier = modifier
            .fillMaxWidth()
            .aedstMinTouchHeight()
            .clip(AedstShapesScale.medium)
            .clickable(role = Role.Button) {
                when {
                    onOpen != null -> onOpen(href)
                    isWebUrl(href) -> uriHandler.openUri(href)
                }
            }
            .semantics(mergeDescendants = true) { contentDescription = name }
            .padding(horizontal = AedstSpacing.sm, vertical = AedstSpacing.xs),
        horizontalArrangement = Arrangement.spacedBy(AedstSpacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        val tint = MaterialTheme.colorScheme.onSurfaceVariant
        if (icon != null) Icon(icon, contentDescription = null, modifier = Modifier.size(AedstSpacing.lg), tint = tint)
        Text(
            text = text,
            modifier = Modifier.weight(1f, fill = false),
            style = MaterialTheme.typography.bodyMedium,
            color = tint,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Icon(
            imageVector = Icons.AutoMirrored.Filled.OpenInNew, // mirrored in right-to-left layouts
            contentDescription = null,
            modifier = Modifier.size(AedstSpacing.lg),
            tint = tint,
        )
    }
}

@Preview(name = "Light", showBackground = true)
@Preview(name = "Dark", uiMode = Configuration.UI_MODE_NIGHT_YES, showBackground = true)
@Composable
private fun AedstAiSourcesPreview() {
    AedstTheme {
        Surface {
            AedstAiSources(modifier = Modifier.padding(AedstSpacing.lg), defaultExpanded = true) {
                AedstAiSourcesTrigger(title = "Used 2 sources")
                AedstAiSourcesContent {
                    AedstAiSource(href = "https://www.example.com/guide", title = "Setup guide", onOpen = {})
                    AedstAiSource(href = "https://docs.example.org/api", icon = Icons.Default.Description, onOpen = {})
                }
            }
        }
    }
}
