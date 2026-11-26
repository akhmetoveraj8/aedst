package com.aedst.core.ui.components

import android.content.res.Configuration
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ProvideTextStyle
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.NonRestartableComposable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import com.aedst.core.ui.theme.AedstShapesScale
import com.aedst.core.ui.theme.AedstSpacing
import com.aedst.core.ui.theme.AedstTheme

/** Which side of the conversation an [AedstMessage] sits on, mirroring web's `message.tsx` `align`. */
enum class AedstMessageAlign {
    /** Incoming: avatar first, content at the start. */
    START,

    /** Outgoing (the signed-in user): content and avatar at the end, mirrored in right-to-left layouts. */
    END,
}

/** Vertical stack of consecutive messages (web `MessageGroup`). */
@Composable
fun AedstMessageGroup(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(AedstSpacing.sm),
        content = content,
    )
}

/**
 * One chat message row, mirroring web's `Message`: an optional [avatar] ([AedstMessageAvatar]) at the bottom of the
 * row, then an optional [header] ([AedstMessageHeader]), the [content] (usually one or more [AedstBubble]s, web
 * `MessageContent`) and an optional [footer] ([AedstMessageFooter]). With [AedstMessageAlign.END] the avatar moves to
 * the end and the content hugs the end edge; start and end follow the layout direction.
 */
@Composable
fun AedstMessage(
    modifier: Modifier = Modifier,
    align: AedstMessageAlign = AedstMessageAlign.START,
    avatar: (@Composable () -> Unit)? = null,
    header: (@Composable () -> Unit)? = null,
    footer: (@Composable () -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    val end = align == AedstMessageAlign.END
    val horizontal = if (end) Alignment.End else Alignment.Start
    // The content column hugs the message's side, so an AedstBubble without its own align follows it.
    Row(
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(AedstSpacing.sm, horizontal),
        verticalAlignment = Alignment.Bottom,
    ) {
        if (!end) avatar?.let { AvatarSlot(hasFooter = footer != null, avatar = it) }
        Column(
            modifier = Modifier.weight(1f, fill = false),
            horizontalAlignment = horizontal,
            verticalArrangement = Arrangement.spacedBy(AedstSpacing.sm),
        ) {
            header?.invoke()
            Column(horizontalAlignment = horizontal, verticalArrangement = Arrangement.spacedBy(AedstSpacing.sm)) {
                content()
            }
            footer?.invoke()
        }
        if (end) avatar?.let { AvatarSlot(hasFooter = footer != null, avatar = it) }
    }
}

/** Keeps the avatar level with the last bubble, above the footer line (web translates it up by the footer height). */
@Composable
private fun AvatarSlot(hasFooter: Boolean, avatar: @Composable () -> Unit) {
    Box(modifier = if (hasFooter) Modifier.padding(bottom = AedstSpacing.xxl) else Modifier) { avatar() }
}

/** Round avatar holder of an [AedstMessage] (web `MessageAvatar`); put an [AedstAvatar] or an icon inside. */
@Composable
fun AedstMessageAvatar(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    Box(
        modifier = modifier
            .sizeIn(minWidth = AedstSpacing.xxxl, minHeight = AedstSpacing.xxxl)
            .clip(AedstShapesScale.pill)
            .background(MaterialTheme.colorScheme.surfaceVariant),
        contentAlignment = Alignment.Center,
    ) { content() }
}

/** Sender name and time above the content of an [AedstMessage] (web `MessageHeader`). */
@Composable
fun AedstMessageHeader(text: String, modifier: Modifier = Modifier) {
    MessageMeta(modifier) { Text(text, maxLines = 1, overflow = TextOverflow.Ellipsis) }
}

/** Status line under the content of an [AedstMessage] (web `MessageFooter`): "Read", "Sending", actions. */
@Composable
@NonRestartableComposable
fun AedstMessageFooter(modifier: Modifier = Modifier, content: @Composable RowScope.() -> Unit) {
    MessageMeta(modifier, content)
}

@Composable
private fun MessageMeta(modifier: Modifier = Modifier, content: @Composable RowScope.() -> Unit) {
    CompositionLocalProvider(LocalContentColor provides MaterialTheme.colorScheme.onSurfaceVariant) {
        Row(
            modifier = modifier.padding(horizontal = AedstSpacing.md),
            horizontalArrangement = Arrangement.spacedBy(AedstSpacing.xs),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            ProvideTextStyle(MaterialTheme.typography.labelMedium) { content() }
        }
    }
}

@Preview(name = "Light", showBackground = true)
@Preview(name = "Dark", uiMode = Configuration.UI_MODE_NIGHT_YES, showBackground = true)
@Composable
private fun AedstMessagePreview() {
    AedstTheme {
        Surface {
            AedstMessageGroup(modifier = Modifier.padding(AedstSpacing.lg)) {
                AedstMessage(
                    avatar = { AedstMessageAvatar { AedstAvatar(initials = "AL", size = AedstAvatarSize.SM) } },
                    header = { AedstMessageHeader("Ada · 09:41") },
                ) {
                    AedstBubble(variant = AedstBubbleVariant.MUTED) { Text("Did the build pass?") }
                }
                AedstMessage(
                    align = AedstMessageAlign.END,
                    footer = { AedstMessageFooter { Text("Read") } },
                ) {
                    AedstBubble { Text("Yes, all green.") }
                }
            }
        }
    }
}
