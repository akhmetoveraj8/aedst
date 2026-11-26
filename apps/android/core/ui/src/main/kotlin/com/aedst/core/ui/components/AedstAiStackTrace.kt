package com.aedst.core.ui.components

import android.content.res.Configuration
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Code
import androidx.compose.material.icons.outlined.Layers
import androidx.compose.material.icons.outlined.Terminal
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.NonRestartableComposable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import com.aedst.core.ui.components.support.AI_LINE_ICON_SIZE
import com.aedst.core.ui.components.support.AiCodePanel
import com.aedst.core.ui.components.support.parseAiStackFrame
import com.aedst.core.ui.theme.AedstShapesScale
import com.aedst.core.ui.theme.AedstSpacing
import com.aedst.core.ui.theme.AedstTheme

/** One frame of a stack trace; [isInternal] marks a dependency or runtime frame (node_modules, node:, internal). */
@Immutable
data class AedstAiStackFrame(
    val raw: String,
    val functionName: String? = null,
    val file: String? = null,
    val line: Int? = null,
    val column: Int? = null,
    val isInternal: Boolean = false,
)

/** A stack split into its first line ("TypeError: Cannot read ...") and parsed [frames]. */
@Immutable
data class AedstAiParsedStack(val error: String, val frames: List<AedstAiStackFrame>) {
    companion object {
        /** Splits `error.stack` (V8, Firefox or Safari format) into the error line and frames (`parseStackTrace`). */
        fun parse(stack: String): AedstAiParsedStack {
            val lines = stack.lineSequence().map(String::trim).filter(String::isNotEmpty).toList()
            return AedstAiParsedStack(lines.firstOrNull().orEmpty(), lines.drop(1).map(::parseAiStackFrame))
        }
    }
}

/** A failed tool call: a line with the error that opens into the frames (web `ai-stack-trace.tsx`). Open by default. */
@Composable
@NonRestartableComposable
fun AedstAiStackTrace(
    modifier: Modifier = Modifier,
    expanded: Boolean? = null,
    defaultExpanded: Boolean = true,
    onExpandedChange: ((Boolean) -> Unit)? = null,
    content: @Composable AedstAiDisclosureScope.() -> Unit,
) {
    AedstAiChainOfThought(modifier, expanded, defaultExpanded, onExpandedChange, content)
}

/** The error as the title ("Failed: TypeError ..."); always the error status. */
@Composable
fun AedstAiDisclosureScope.AedstAiStackTraceHeader(
    title: String,
    modifier: Modifier = Modifier,
    statusLabel: String? = null,
    description: String? = null,
    icon: ImageVector = Icons.Outlined.Terminal,
) {
    AedstAiChainOfThoughtHeader(title, modifier, AedstTraceStatus.ERROR, statusLabel, description, icon)
}

@Composable
@NonRestartableComposable
fun AedstAiDisclosureScope.AedstAiStackTraceContent(
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    AedstAiChainOfThoughtContent(modifier = modifier, content = content)
}

/** The full error line (the header truncates, this wraps): mono, destructive colour, left to right. */
@Composable
fun AedstAiStackTraceError(text: String, modifier: Modifier = Modifier) {
    CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Ltr) {
        Text(
            text = text,
            style = MaterialTheme.typography.bodySmall,
            fontFamily = FontFamily.Monospace,
            color = MaterialTheme.colorScheme.error,
            modifier = modifier,
        )
    }
}

/**
 * App frames first (left to right), each a 48dp button when [onFrameClick] is set (open the file at the line); the
 * dependency frames are folded into one collapsible line titled [internalFramesLabel] ("4 framework frames").
 * [onCopy] shows the copy button of the folded frames.
 */
@Composable
fun AedstAiStackTraceFrames(
    frames: List<AedstAiStackFrame>,
    internalFramesLabel: String,
    modifier: Modifier = Modifier,
    onFrameClick: ((AedstAiStackFrame) -> Unit)? = null,
    onCopy: (() -> Unit)? = null,
) {
    val (internalFrames, appFrames) = remember(frames) { frames.partition(AedstAiStackFrame::isInternal) }
    Column(modifier = modifier.fillMaxWidth()) {
        CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Ltr) {
            Column {
                appFrames.forEach { frame -> FrameRow(frame, onFrameClick) }
            }
        }
        if (internalFrames.isNotEmpty()) {
            val code = remember(internalFrames) {
                internalFrames.joinToString("\n", transform = AedstAiStackFrame::raw)
            }
            AedstAiChainOfThought {
                AedstAiChainOfThoughtHeader(title = internalFramesLabel, icon = Icons.Outlined.Layers)
                AedstAiChainOfThoughtContent { AiCodePanel(code = code, onCopy = onCopy) }
            }
        }
    }
}

@Composable
private fun FrameRow(frame: AedstAiStackFrame, onFrameClick: ((AedstAiStackFrame) -> Unit)?) {
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    val click = if (onFrameClick != null) {
        Modifier.clickable(role = Role.Button) { onFrameClick(frame) }.heightIn(min = AedstSpacing.massive)
    } else {
        Modifier.heightIn(min = AedstSpacing.xxxl)
    }
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(AedstShapesScale.medium)
            .then(click)
            .padding(horizontal = AedstSpacing.sm, vertical = FRAME_PADDING),
        horizontalArrangement = Arrangement.spacedBy(AedstSpacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Outlined.Code, contentDescription = null, tint = muted, modifier = Modifier.size(AI_LINE_ICON_SIZE))
        if (frame.file == null) {
            FrameText(frame.raw, muted, Modifier.weight(1f, fill = false))
        } else {
            if (frame.functionName != null) FrameText(frame.functionName, MaterialTheme.colorScheme.onSurface)
            FrameText("${frame.file}:${frame.line}", muted, Modifier.weight(1f, fill = false))
        }
    }
}

@Composable
private fun FrameText(text: String, color: Color, modifier: Modifier = Modifier) {
    Text(
        text = text,
        style = MaterialTheme.typography.bodySmall,
        fontFamily = FontFamily.Monospace,
        color = color,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
        modifier = modifier,
    )
}

private val FRAME_PADDING = 6.dp // allow-dp: web py-1.5

@Preview(name = "Light", showBackground = true)
@Preview(name = "Dark", uiMode = Configuration.UI_MODE_NIGHT_YES, showBackground = true)
@Composable
private fun AedstAiStackTracePreview() {
    val stack = AedstAiParsedStack.parse(
        "TypeError: Cannot read properties of undefined\n" +
            "at render (src/app/page.tsx:12:5)\n" +
            "at Object.run (node_modules/react-dom/client.js:100:3)\n" +
            "at node:internal/process:1:1",
    )
    AedstTheme {
        Surface {
            AedstAiStackTrace {
                AedstAiStackTraceHeader(title = "Failed: ${stack.error}")
                AedstAiStackTraceContent {
                    AedstAiStackTraceError(stack.error)
                    AedstAiStackTraceFrames(
                        frames = stack.frames,
                        internalFramesLabel = "2 framework frames",
                        onFrameClick = {},
                    )
                }
            }
        }
    }
}
