package com.aedst.core.ui.components

import android.content.res.Configuration
import androidx.compose.foundation.gestures.snapping.rememberSnapFlingBehavior
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.InsertDriveFile
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.error
import androidx.compose.ui.semantics.progressBarRangeInfo
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import com.aedst.core.ui.components.support.AttachmentFrame
import com.aedst.core.ui.components.support.AttachmentLayout
import com.aedst.core.ui.components.support.attachmentMediaColors
import com.aedst.core.ui.components.support.gap
import com.aedst.core.ui.components.support.media
import com.aedst.core.ui.components.support.mediaShape
import com.aedst.core.ui.theme.AedstSpacing
import com.aedst.core.ui.theme.AedstTheme

/** What an [AedstAttachmentMedia] shows, mirroring web's `AttachmentMedia` `variant`. */
enum class AedstAttachmentVariant {
    /** A file-type icon on a muted square. */
    ICON,

    /** A thumbnail; dimmed until the upload is done. */
    IMAGE,
}

/** Density of an [AedstAttachment], mirroring web's `attachment.tsx` `size` (media 40 / 32 / 28dp). */
enum class AedstAttachmentSize { DEFAULT, SM, XS }

/** Layout of an [AedstAttachment] (web `orientation`): a row chip, or a tile with the media on top. */
enum class AedstAttachmentOrientation { HORIZONTAL, VERTICAL }

/** Upload lifecycle of an [AedstAttachment] (web `state`). */
enum class AedstAttachmentState {
    /** Not uploaded yet (dashed border). */
    IDLE,
    UPLOADING,
    PROCESSING,

    /** Failed: destructive border, media and description; announced as an error. */
    ERROR,
    DONE,
}

/**
 * Receiver of an [AedstAttachment]'s `media`: carries the attachment's size, orientation and state, which
 * [AedstAttachmentMedia] (an extension on this scope) reads explicitly instead of a CompositionLocal.
 */
@Stable
sealed class AedstAttachmentScope {
    internal abstract val layout: AttachmentLayout
}

private class AedstAttachmentScopeImpl(override val layout: AttachmentLayout) : AedstAttachmentScope()

/**
 * A file chip or tile, mirroring web's `Attachment` with `AttachmentContent`, `AttachmentTitle` and
 * `AttachmentDescription`: [media] (usually [AedstAttachmentMedia]), the [title] (one line) and an optional
 * [description] (size, error text), then [actions] ([AedstAttachmentAction]). [onClick] makes the whole attachment a
 * button (web `AttachmentTrigger`), e.g. to open a preview. While [state] is uploading or processing the attachment
 * reports itself busy (indeterminate progress) to accessibility services.
 */
@Composable
fun AedstAttachment(
    title: String,
    modifier: Modifier = Modifier,
    description: String? = null,
    state: AedstAttachmentState = AedstAttachmentState.DONE,
    size: AedstAttachmentSize = AedstAttachmentSize.DEFAULT,
    orientation: AedstAttachmentOrientation = AedstAttachmentOrientation.HORIZONTAL,
    onClick: (() -> Unit)? = null,
    media: (@Composable AedstAttachmentScope.() -> Unit)? = null,
    actions: (@Composable RowScope.() -> Unit)? = null,
) {
    val busy = state == AedstAttachmentState.UPLOADING || state == AedstAttachmentState.PROCESSING
    val semantics = Modifier.semantics {
        if (busy) progressBarRangeInfo = ProgressBarRangeInfo.Indeterminate
        if (state == AedstAttachmentState.ERROR) error(description ?: title)
    }
    val vertical = orientation == AedstAttachmentOrientation.VERTICAL
    val text: @Composable (Modifier) -> Unit = { textModifier ->
        AttachmentText(title, description, state, size, busy, textModifier)
    }
    val scope = remember(size, orientation, state) {
        AedstAttachmentScopeImpl(AttachmentLayout(size, orientation, state))
    }
    val mediaSlot: (@Composable () -> Unit)? = media?.let { slot -> { scope.slot() } }
    AttachmentFrame(
        modifier = modifier.then(semantics),
        size = size,
        orientation = orientation,
        state = state,
        onClick = onClick,
    ) {
        if (vertical) {
            Box {
                Column(verticalArrangement = Arrangement.spacedBy(size.gap)) {
                    mediaSlot?.invoke()
                    text(Modifier.padding(horizontal = AedstSpacing.xs))
                }
                if (actions != null) {
                    Row(modifier = Modifier.align(Alignment.TopEnd).padding(AedstSpacing.xs), content = actions)
                }
            }
        } else {
            Row(
                modifier = Modifier.widthIn(min = MIN_ROW_WIDTH),
                horizontalArrangement = Arrangement.spacedBy(size.gap),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                mediaSlot?.invoke()
                text(Modifier.weight(1f, fill = false))
                actions?.let { Row(verticalAlignment = Alignment.CenterVertically, content = it) }
            }
        }
    }
}

@Composable
private fun AttachmentText(
    title: String,
    description: String?,
    state: AedstAttachmentState,
    size: AedstAttachmentSize,
    busy: Boolean,
    modifier: Modifier = Modifier,
) {
    val style = if (size ==
        AedstAttachmentSize.DEFAULT
    ) {
        MaterialTheme.typography.bodyMedium
    } else {
        MaterialTheme.typography.bodySmall
    }
    Column(modifier = modifier) {
        Text(
            text = title,
            modifier = if (busy) Modifier.alpha(BUSY_ALPHA) else Modifier,
            style = style,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        if (description != null) {
            Text(
                text = description,
                style = MaterialTheme.typography.bodySmall,
                color = if (state == AedstAttachmentState.ERROR) {
                    MaterialTheme.colorScheme.error
                } else {
                    MaterialTheme.colorScheme.onSurfaceVariant
                },
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

/**
 * The square media of an [AedstAttachment] (web `AttachmentMedia`): sized by the attachment, full width in a vertical
 * tile, tinted destructive on error; an [AedstAttachmentVariant.IMAGE] is dimmed while not done or idle.
 */
@Composable
fun AedstAttachmentScope.AedstAttachmentMedia(
    modifier: Modifier = Modifier,
    variant: AedstAttachmentVariant = AedstAttachmentVariant.ICON,
    content: @Composable BoxScope.() -> Unit,
) {
    val (size, orientation, state) = layout
    val colors = attachmentMediaColors(state)
    val dimmed = variant == AedstAttachmentVariant.IMAGE &&
        state != AedstAttachmentState.DONE &&
        state != AedstAttachmentState.IDLE
    val sized = if (orientation == AedstAttachmentOrientation.VERTICAL) {
        modifier.fillMaxWidth().aspectRatio(1f)
    } else {
        modifier.width(size.media).aspectRatio(1f)
    }
    Surface(
        modifier = if (dimmed) sized.alpha(BUSY_ALPHA) else sized,
        shape = size.mediaShape,
        color = colors.container,
        contentColor = colors.content,
    ) {
        Box(contentAlignment = Alignment.Center, content = content)
    }
}

/** A ghost icon button in [AedstAttachment]'s actions (web `AttachmentAction`, `icon-xs`); keeps a 48dp target. */
@Composable
fun AedstAttachmentAction(
    onClick: () -> Unit,
    contentDescription: String,
    modifier: Modifier = Modifier,
    icon: @Composable () -> Unit,
) {
    AedstButton(
        text = contentDescription,
        onClick = onClick,
        modifier = modifier,
        variant = AedstButtonVariant.GHOST,
        size = AedstButtonSize.ICON_XS,
        leadingIcon = { icon() },
    )
}

/** Horizontally scrolling, snapping row of attachments (web `AttachmentGroup`), lazy for long lists. */
@Composable
fun AedstAttachmentGroup(modifier: Modifier = Modifier, content: LazyListScope.() -> Unit) {
    val state = rememberLazyListState()
    LazyRow(
        modifier = modifier.fillMaxWidth(),
        state = state,
        contentPadding = PaddingValues(vertical = AedstSpacing.xs),
        horizontalArrangement = Arrangement.spacedBy(AedstSpacing.md),
        flingBehavior = rememberSnapFlingBehavior(state),
        content = content,
    )
}

private val MIN_ROW_WIDTH = AedstSpacing.giant + AedstSpacing.giant + AedstSpacing.xxxl // web min-w-40 (160dp)
private const val BUSY_ALPHA = 0.6f

@Preview(name = "Light", showBackground = true)
@Preview(name = "Dark", uiMode = Configuration.UI_MODE_NIGHT_YES, showBackground = true)
@Composable
private fun AedstAttachmentPreview() {
    AedstTheme {
        Surface {
            Column(
                modifier = Modifier.padding(AedstSpacing.lg),
                verticalArrangement = Arrangement.spacedBy(AedstSpacing.md),
            ) {
                AedstAttachmentState.entries.forEach { state ->
                    AedstAttachment(
                        title = "report-${state.name.lowercase()}.pdf",
                        description = "2.4 MB",
                        state = state,
                        media = {
                            AedstAttachmentMedia {
                                Icon(Icons.AutoMirrored.Filled.InsertDriveFile, contentDescription = null)
                            }
                        },
                        actions = {
                            AedstAttachmentAction(onClick = {}, contentDescription = "Remove") {
                                Icon(Icons.Default.Close, contentDescription = null)
                            }
                        },
                    )
                }
                AedstAttachment(
                    title = "photo.jpg",
                    size = AedstAttachmentSize.SM,
                    orientation = AedstAttachmentOrientation.VERTICAL,
                    media = { AedstAttachmentMedia(variant = AedstAttachmentVariant.IMAGE) {} },
                )
            }
        }
    }
}
