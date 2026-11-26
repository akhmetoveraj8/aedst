package com.aedst.core.ui.components

import android.content.res.Configuration
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ProvideTextStyle
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.aedst.core.ui.R
import com.aedst.core.ui.components.support.contextRatio
import com.aedst.core.ui.components.support.rememberAiNumberFormats
import com.aedst.core.ui.theme.AedstShapesScale
import com.aedst.core.ui.theme.AedstSpacing
import com.aedst.core.ui.theme.AedstTheme

/** Token breakdown of the conversation (web `AiContextUsage`); a null count hides its row. */
@Immutable
data class AedstAiContextUsage(
    val inputTokens: Long? = null,
    val outputTokens: Long? = null,
    val reasoningTokens: Long? = null,
    val cachedInputTokens: Long? = null,
)

@Immutable
internal data class AiContextValue(val usedTokens: Long, val maxTokens: Long, val usage: AedstAiContextUsage?) {
    val ratio: Float = contextRatio(usedTokens, maxTokens)
}

/**
 * Receiver of [AedstAiContext]'s popover content: carries the token counts, which the header and usage rows
 * (extensions on this scope) read explicitly instead of a CompositionLocal.
 */
@Stable
sealed class AedstAiContextScope {
    internal abstract val value: AiContextValue
}

private class AiContextScopeImpl(override val value: AiContextValue) : AedstAiContextScope()

/** A scope over fixed values; internal so the component catalog and previews can render the parts alone. */
internal fun aiContextScope(usedTokens: Long, maxTokens: Long, usage: AedstAiContextUsage?): AedstAiContextScope =
    AiContextScopeImpl(AiContextValue(usedTokens, maxTokens, usage))

/**
 * How much of the model's context window the conversation used, mirroring web's `AiContext` + `AiContextTrigger` +
 * `AiContextContent` (shadcn AI Elements "Context"). A small outline button shows the share used as a locale-formatted
 * percentage and is named "[label]: 42%"; a tap opens an [AedstPopover] (web opens a hover card on hover and focus,
 * which a touch screen lacks) holding [content]: [AedstAiContextContentHeader], [AedstAiContextContentBody] with the
 * usage rows, [AedstAiContextContentFooter]. [maxTokens] is the model's window, set per model.
 */
@Composable
fun AedstAiContext(
    usedTokens: Long,
    maxTokens: Long,
    modifier: Modifier = Modifier,
    usage: AedstAiContextUsage? = null,
    label: String = stringResource(R.string.aedst_a11y_context_used),
    content: @Composable AedstAiContextScope.() -> Unit,
) {
    val scope = remember(usedTokens, maxTokens, usage) { aiContextScope(usedTokens, maxTokens, usage) }
    val value = scope.value
    val percent = rememberAiNumberFormats().percent(value.ratio)
    var expanded by rememberSaveable { mutableStateOf(false) }
    val state = stringResource(if (expanded) R.string.aedst_a11y_expanded else R.string.aedst_a11y_collapsed)
    AedstPopover(
        expanded = expanded,
        onDismissRequest = { expanded = false },
        modifier = modifier,
        trigger = {
            AedstButton(
                text = percent,
                onClick = { expanded = !expanded },
                modifier = Modifier.semantics {
                    contentDescription = "$label: $percent"
                    stateDescription = state
                },
                variant = AedstButtonVariant.OUTLINE,
                size = AedstButtonSize.SM,
            )
        },
    ) {
        // The popover panel already pads its content, so the parts only add vertical rhythm.
        Column(modifier = Modifier.width(CARD_WIDTH)) { scope.content() }
    }
}

/** Heading [label], used / max tokens (compact, locale-aware) and the progress bar named [label]. */
@Composable
fun AedstAiContextScope.AedstAiContextContentHeader(label: String, modifier: Modifier = Modifier) {
    val context = value
    val formats = rememberAiNumberFormats()
    Column(
        modifier = modifier.fillMaxWidth().padding(vertical = AedstSpacing.sm),
        verticalArrangement = Arrangement.spacedBy(AedstSpacing.sm),
    ) {
        Row(
            horizontalArrangement = Arrangement.spacedBy(AedstSpacing.md),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(label, style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
            Text(
                text = "${formats.tokens(context.usedTokens)} / ${formats.tokens(context.maxTokens)}",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        AedstLinearProgressIndicator(
            progress = context.ratio,
            modifier = Modifier.semantics { contentDescription = label },
        )
    }
}

/** The usage rows (web `AiContextContentBody`). */
@Composable
fun AedstAiContextContentBody(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    AedstDivider()
    Column(
        modifier = modifier.fillMaxWidth().padding(vertical = AedstSpacing.sm),
        verticalArrangement = Arrangement.spacedBy(AedstSpacing.xs),
    ) {
        ProvideTextStyle(MaterialTheme.typography.bodyMedium) { content() }
    }
}

/** Secondary strip at the bottom, e.g. the cost (web `AiContextContentFooter`). */
@Composable
fun AedstAiContextContentFooter(modifier: Modifier = Modifier, content: @Composable RowScope.() -> Unit) {
    val colors = MaterialTheme.colorScheme
    CompositionLocalProvider(LocalContentColor provides colors.onSecondaryContainer) {
        Row(
            modifier = modifier
                .fillMaxWidth()
                .background(colors.secondaryContainer, AedstShapesScale.medium)
                .padding(AedstSpacing.sm),
            horizontalArrangement = Arrangement.spacedBy(AedstSpacing.md, Alignment.End),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            ProvideTextStyle(MaterialTheme.typography.labelMedium) { content() }
        }
    }
}

/** Input tokens row; nothing when the usage lacks the count. */
@Composable
fun AedstAiContextScope.AedstAiContextInputUsage(label: String, modifier: Modifier = Modifier) =
    UsageRow(label, value.usage?.inputTokens, modifier)

/** Output tokens row; nothing when the usage lacks the count. */
@Composable
fun AedstAiContextScope.AedstAiContextOutputUsage(label: String, modifier: Modifier = Modifier) =
    UsageRow(label, value.usage?.outputTokens, modifier)

/** Reasoning tokens row; nothing when the usage lacks the count. */
@Composable
fun AedstAiContextScope.AedstAiContextReasoningUsage(label: String, modifier: Modifier = Modifier) =
    UsageRow(label, value.usage?.reasoningTokens, modifier)

/** Cached input tokens row; nothing when the usage lacks the count. */
@Composable
fun AedstAiContextScope.AedstAiContextCacheUsage(label: String, modifier: Modifier = Modifier) =
    UsageRow(label, value.usage?.cachedInputTokens, modifier)

@Composable
private fun UsageRow(label: String, tokens: Long?, modifier: Modifier = Modifier) {
    if (tokens == null) return
    val formats = rememberAiNumberFormats()
    Row(modifier = modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(AedstSpacing.md)) {
        Text(label, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f))
        Text(formats.tokens(tokens))
    }
}

private val CARD_WIDTH = 256.dp // web w-64

@Preview(name = "Light", showBackground = true)
@Preview(name = "Dark", uiMode = Configuration.UI_MODE_NIGHT_YES, showBackground = true)
@Composable
private fun AedstAiContextPreview() {
    AedstTheme {
        Surface {
            Column(modifier = Modifier.padding(AedstSpacing.lg)) {
                AedstAiContext(usedTokens = 54_000, maxTokens = 128_000) {}
                with(aiContextScope(54_000, 128_000, AedstAiContextUsage(40_000, 9_000, 5_000))) {
                    Column(modifier = Modifier.width(CARD_WIDTH)) {
                        AedstAiContextContentHeader(label = "Context")
                        AedstAiContextContentBody {
                            AedstAiContextInputUsage("Input")
                            AedstAiContextOutputUsage("Output")
                            AedstAiContextReasoningUsage("Reasoning")
                            AedstAiContextCacheUsage("Cache")
                        }
                    }
                }
            }
        }
    }
}
