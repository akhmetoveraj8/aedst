package com.aedst.core.ui.adaptive

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.adaptive.currentWindowAdaptiveInfoV2
import androidx.compose.material3.adaptive.separatingHorizontalHingeBounds
import androidx.compose.material3.adaptive.separatingVerticalHingeBounds
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/** Readable content widths for single-column screens on windows wider than a phone. */
object AedstContentWidth {
    /** Sign-in, create and settings forms. */
    val form: Dp = 480.dp

    /** Detail and reading screens. */
    val reading: Dp = 640.dp

    /** Lists and grids: wide enough for a row with metadata, narrow enough to scan. */
    val list: Dp = 840.dp

    /** Grids and side-by-side layouts (media library, expanded media detail): wide, not edge to edge on a monitor. */
    val wide: Dp = 1200.dp
}

/**
 * Places single-pane screen content for any window: centered at no more than [maxWidth] (so a form or list does not
 * stretch across a 1000dp tablet) and kept in the larger half when a foldable's hinge splits the window
 * ([hingeSafeInsets]). On a phone it is a no-op. Use it inside the `Scaffold` content slot so the app bar stays full
 * width.
 */
@Composable
fun AedstAdaptiveContent(
    modifier: Modifier = Modifier,
    maxWidth: Dp = AedstContentWidth.reading,
    content: @Composable BoxScope.() -> Unit,
) {
    val posture = currentWindowAdaptiveInfoV2().windowPosture
    val windowSize = LocalWindowInfo.current.containerSize
    val insets = remember(posture, windowSize) {
        hingeSafeInsets(
            windowWidthPx = windowSize.width,
            windowHeightPx = windowSize.height,
            verticalHinges = posture.separatingVerticalHingeBounds,
            horizontalHinges = posture.separatingHorizontalHingeBounds,
        )
    }
    val density = LocalDensity.current
    val padding = with(density) {
        PaddingValues.Absolute(
            left = insets.leftPx.toDp(),
            top = insets.topPx.toDp(),
            right = insets.rightPx.toDp(),
            bottom = insets.bottomPx.toDp(),
        )
    }
    Box(modifier = modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.TopCenter) {
        Box(modifier = Modifier.widthIn(max = maxWidth).fillMaxSize(), content = content)
    }
}
