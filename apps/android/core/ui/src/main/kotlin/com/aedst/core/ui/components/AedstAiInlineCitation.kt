package com.aedst.core.ui.components

import android.content.res.Configuration
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.FlowRowScope
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.aedst.core.ui.R
import com.aedst.core.ui.components.support.citationHostname
import com.aedst.core.ui.components.support.isWebUrl
import com.aedst.core.ui.theme.AedstSpacing
import com.aedst.core.ui.theme.AedstTheme

/** Wraps a host name in a left-to-right isolate so it keeps its order inside right-to-left text. */
private fun ltr(text: String) = "⁦$text⁩"

/**
 * A cited sentence, mirroring web's `AiInlineCitation` (shadcn AI Elements "Inline Citation"): the
 * [AedstAiInlineCitationText] and its [AedstAiInlineCitationCard], kept together and wrapping as one flow.
 */
@Composable
fun AedstAiInlineCitation(modifier: Modifier = Modifier, content: @Composable FlowRowScope.() -> Unit) {
    FlowRow(
        modifier = modifier,
        horizontalArrangement = Arrangement.spacedBy(AedstSpacing.xs),
        itemVerticalAlignment = Alignment.CenterVertically,
        content = content,
    )
}

/** The cited text (web `AiInlineCitationText`). */
@Composable
fun AedstAiInlineCitationText(text: String, modifier: Modifier = Modifier) {
    Text(text = text, modifier = modifier, style = MaterialTheme.typography.bodyMedium)
}

/**
 * The citation chip and its card (web `AiInlineCitationCard` + `AiInlineCitationCardBody`). Web opens a hover card
 * on hover and focus; a touch screen has neither, so a tap on the [AedstAiInlineCitationCardTrigger] opens an
 * [AedstPopover] holding [body] ([AedstAiInlineCitationSource]s, an [AedstAiInlineCitationQuote]).
 */
@Composable
fun AedstAiInlineCitationCard(
    sources: List<String>,
    modifier: Modifier = Modifier,
    moreLabel: String? = null,
    body: @Composable ColumnScope.() -> Unit,
) {
    var expanded by rememberSaveable { mutableStateOf(false) }
    AedstPopover(
        expanded = expanded,
        onDismissRequest = { expanded = false },
        modifier = modifier,
        trigger = {
            AedstAiInlineCitationCardTrigger(
                sources = sources,
                onClick = { expanded = !expanded },
                expanded = expanded,
                moreLabel = moreLabel,
            )
        },
    ) {
        Column(
            modifier = Modifier.widthIn(max = CARD_WIDTH),
            verticalArrangement = Arrangement.spacedBy(AedstSpacing.md),
            content = body,
        )
    }
}

/**
 * A focusable secondary extra-small button (not a badge) showing the first source's host name and `+N` for the
 * others (web `AiInlineCitationCardTrigger`). It is named "host, [moreLabel]" (e.g. "and 2 more sources") and
 * exposes the expanded / collapsed state of the card.
 */
@Composable
fun AedstAiInlineCitationCardTrigger(
    sources: List<String>,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    expanded: Boolean = false,
    moreLabel: String? = null,
) {
    val host = sources.firstOrNull()?.let(::citationHostname).orEmpty()
    val more = sources.size - 1
    val visible = if (more > 0) stringResource(R.string.aedst_a11y_plus_more, ltr(host), more) else ltr(host)
    val name = if (more > 0 && moreLabel != null) {
        stringResource(R.string.aedst_a11y_name_hint, host, moreLabel)
    } else {
        visible
    }
    val state = stringResource(if (expanded) R.string.aedst_a11y_expanded else R.string.aedst_a11y_collapsed)
    AedstButton(
        text = visible,
        onClick = onClick,
        modifier = modifier.semantics {
            contentDescription = name
            stateDescription = state
        },
        variant = AedstButtonVariant.SECONDARY,
        size = AedstButtonSize.XS,
    )
}

/**
 * One source (web `AiInlineCitationSource`): [title] (the host name when null), [description] and a link that opens
 * [url] in the browser, named "host, [newTabLabel]". [onOpen] overrides opening; by default only `http` / `https`
 * links open.
 */
@Composable
fun AedstAiInlineCitationSource(
    url: String,
    modifier: Modifier = Modifier,
    title: String? = null,
    description: String? = null,
    newTabLabel: String = stringResource(R.string.aedst_a11y_opens_in_browser),
    onOpen: ((String) -> Unit)? = null,
) {
    val host = citationHostname(url)
    val uriHandler = LocalUriHandler.current
    val linkName = stringResource(R.string.aedst_a11y_name_hint, host, newTabLabel)
    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(AedstSpacing.xs)) {
        Text(text = title ?: ltr(host), style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
        if (description != null) {
            Text(
                text = description,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        AedstButton(
            text = ltr(host),
            onClick = {
                when {
                    onOpen != null -> onOpen(url)
                    isWebUrl(url) -> uriHandler.openUri(url)
                }
            },
            modifier = Modifier.semantics { contentDescription = linkName },
            variant = AedstButtonVariant.LINK,
            size = AedstButtonSize.XS,
        )
    }
}

/** The quoted passage the citation supports, with a rule on the start edge (web `AiInlineCitationQuote`). */
@Composable
fun AedstAiInlineCitationQuote(text: String, modifier: Modifier = Modifier) {
    Row(modifier = modifier.height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(AedstSpacing.md)) {
        Box(
            modifier = Modifier
                .width(AedstSpacing.xxs) // web border-s-2
                .fillMaxHeight()
                .background(MaterialTheme.colorScheme.outlineVariant),
        )
        Text(
            text = text,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            fontStyle = FontStyle.Italic,
        )
    }
}

private val CARD_WIDTH = 288.dp // web w-72

@Preview(name = "Light", showBackground = true)
@Preview(name = "Dark", uiMode = Configuration.UI_MODE_NIGHT_YES, showBackground = true)
@Composable
private fun AedstAiInlineCitationPreview() {
    AedstTheme {
        Surface {
            Column(
                modifier = Modifier.padding(AedstSpacing.lg),
                verticalArrangement = Arrangement.spacedBy(AedstSpacing.md),
            ) {
                AedstAiInlineCitation {
                    AedstAiInlineCitationText("Compose supports right-to-left layouts.")
                    AedstAiInlineCitationCard(
                        sources = listOf("https://www.example.com/rtl", "https://docs.example.org/i18n"),
                        moreLabel = "and 1 more source",
                    ) {}
                }
                AedstAiInlineCitationSource(
                    url = "https://www.example.com/rtl",
                    description = "Layout guide",
                    onOpen = {},
                )
                AedstAiInlineCitationQuote("Layouts mirror automatically.")
            }
        }
    }
}
