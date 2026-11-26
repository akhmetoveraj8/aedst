package com.aedst.core.ui.components.support

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.aedst.core.ui.components.AedstAttachmentOrientation
import com.aedst.core.ui.components.AedstAttachmentSize
import com.aedst.core.ui.components.AedstAttachmentState
import com.aedst.core.ui.theme.AedstRadius
import com.aedst.core.ui.theme.AedstShapesScale
import com.aedst.core.ui.theme.AedstSpacing

/**
 * What an attachment's parts need to know about the enclosing attachment (web reads it through `group-data-*`), handed
 * to them through the attachment's `AedstAttachmentScope`.
 */
@Immutable
internal data class AttachmentLayout(
    val size: AedstAttachmentSize,
    val orientation: AedstAttachmentOrientation,
    val state: AedstAttachmentState,
)

/** Edge length of the media square in a horizontal attachment (web `w-10` / `w-8` / `w-7`). */
internal val AedstAttachmentSize.media: Dp
    get() = when (this) {
        AedstAttachmentSize.DEFAULT -> AedstSpacing.huge
        AedstAttachmentSize.SM -> AedstSpacing.xxxl
        AedstAttachmentSize.XS -> AedstSpacing.xxl + AedstSpacing.xs
    }

internal val AedstAttachmentSize.gap: Dp
    get() = when (this) {
        AedstAttachmentSize.DEFAULT, AedstAttachmentSize.SM -> AedstSpacing.sm
        AedstAttachmentSize.XS -> AedstSpacing.xs + AedstSpacing.xxs
    }

private val AedstAttachmentSize.padding: Dp
    get() = when (this) {
        AedstAttachmentSize.DEFAULT -> AedstSpacing.sm
        AedstAttachmentSize.SM -> AedstSpacing.xs + AedstSpacing.xxs
        AedstAttachmentSize.XS -> AedstSpacing.xs
    }

private val AedstAttachmentSize.shape: Shape
    get() = if (this == AedstAttachmentSize.XS) AedstShapesScale.large else AedstShapesScale.extraLarge

internal val AedstAttachmentSize.mediaShape: Shape
    get() = if (this == AedstAttachmentSize.XS) AedstShapesScale.small else AedstShapesScale.large

/** Container and content colors of the media square for [state]. */
@Immutable
internal class AttachmentMediaColors(val container: Color, val content: Color)

@Composable
internal fun attachmentMediaColors(state: AedstAttachmentState): AttachmentMediaColors {
    val scheme = MaterialTheme.colorScheme
    return if (state == AedstAttachmentState.ERROR) {
        AttachmentMediaColors(scheme.error.copy(alpha = ERROR_FILL), scheme.error)
    } else {
        AttachmentMediaColors(scheme.surfaceVariant, scheme.onSurface)
    }
}

/**
 * The card of an attachment: border (dashed while idle, destructive while failed), padding by size, a fixed tile width
 * when vertical, and the whole card as a button when [onClick] is set.
 */
@Composable
internal fun AttachmentFrame(
    size: AedstAttachmentSize,
    orientation: AedstAttachmentOrientation,
    state: AedstAttachmentState,
    onClick: (() -> Unit)?,
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    val scheme = MaterialTheme.colorScheme
    val borderColor = if (state ==
        AedstAttachmentState.ERROR
    ) {
        scheme.error.copy(alpha = ERROR_BORDER)
    } else {
        scheme.outlineVariant
    }
    val dashed = state == AedstAttachmentState.IDLE
    val radius = if (size == AedstAttachmentSize.XS) AedstRadius.lg else AedstRadius.xl
    val sized = if (orientation == AedstAttachmentOrientation.VERTICAL) modifier.width(TILE_WIDTH) else modifier
    val framed = if (dashed) {
        sized.drawWithContent {
            drawContent()
            val stroke = Stroke(width = BORDER.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(DASH, DASH)))
            drawRoundRect(color = borderColor, cornerRadius = CornerRadius(radius.toPx()), style = stroke)
        }
    } else {
        sized
    }
    val border = if (dashed) null else BorderStroke(BORDER, borderColor)
    val body: @Composable () -> Unit = { Box(modifier = Modifier.padding(size.padding)) { content() } }
    if (onClick == null) {
        Surface(modifier = framed, shape = size.shape, color = scheme.surface, border = border, content = body)
    } else {
        Surface(
            onClick = onClick,
            modifier = framed,
            shape = size.shape,
            color = scheme.surface,
            border = border,
            content = body,
        )
    }
}

private val BORDER = 1.dp // allow-dp: hairline border
private val TILE_WIDTH = 120.dp // allow-dp: web w-30 vertical tile with content
private const val DASH = 8f
private const val ERROR_FILL = 0.1f
private const val ERROR_BORDER = 0.3f
