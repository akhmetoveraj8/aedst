package com.aedst.core.ui.adaptive

import androidx.compose.runtime.Immutable
import androidx.compose.ui.geometry.Rect

/** Physical (left/right, not start/end) pixel insets that keep content on one side of a separating hinge. */
@Immutable
data class AedstHingeInsets(val leftPx: Int = 0, val topPx: Int = 0, val rightPx: Int = 0, val bottomPx: Int = 0) {
    companion object {
        val none = AedstHingeInsets()
    }
}

/**
 * Where single-pane content may be drawn on a foldable. A separating hinge (the fold of a half-opened device, or a
 * physical gap between two displays) splits the window in two: content that straddles it is cut in half or hidden under
 * the seam. This keeps the content in the larger half: the left or right half for a vertical fold (book posture), the
 * top or bottom half for a horizontal one (tabletop posture). Several hinges are handled by the first of each
 * orientation. Panes of a list-detail scaffold do not need this: the pane scaffold already places panes around hinges.
 *
 * @param verticalHinges bounds (window pixels) of vertical separating hinges
 * @param horizontalHinges bounds (window pixels) of horizontal separating hinges
 */
fun hingeSafeInsets(
    windowWidthPx: Int,
    windowHeightPx: Int,
    verticalHinges: List<Rect>,
    horizontalHinges: List<Rect>,
): AedstHingeInsets {
    val vertical = verticalHinges.firstOrNull()
    val horizontal = horizontalHinges.firstOrNull()
    var left = 0
    var right = 0
    var top = 0
    var bottom = 0
    if (vertical != null) {
        val leftHalf = vertical.left.toInt().coerceIn(0, windowWidthPx)
        val rightHalf = (windowWidthPx - vertical.right.toInt()).coerceIn(0, windowWidthPx)
        if (leftHalf >= rightHalf) right = windowWidthPx - leftHalf else left = windowWidthPx - rightHalf
    }
    if (horizontal != null) {
        val topHalf = horizontal.top.toInt().coerceIn(0, windowHeightPx)
        val bottomHalf = (windowHeightPx - horizontal.bottom.toInt()).coerceIn(0, windowHeightPx)
        if (topHalf >= bottomHalf) bottom = windowHeightPx - topHalf else top = windowHeightPx - bottomHalf
    }
    return AedstHingeInsets(leftPx = left, topPx = top, rightPx = right, bottomPx = bottom)
}
