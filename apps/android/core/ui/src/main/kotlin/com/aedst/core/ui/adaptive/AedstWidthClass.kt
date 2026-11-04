package com.aedst.core.ui.adaptive

import androidx.compose.material3.adaptive.currentWindowAdaptiveInfoV2
import androidx.compose.runtime.Composable
import androidx.window.core.layout.WindowSizeClass

/**
 * The three Material window width classes every screen adapts to (compact < 600dp <= medium < 840dp <= expanded).
 * Large and extra-large windows (1200dp+, desktop mode, external displays) are part of [EXPANDED]: screens cap their
 * content width with [AedstAdaptiveContent] instead of inventing more layouts.
 */
enum class AedstWidthClass {
    COMPACT,
    MEDIUM,
    EXPANDED,
    ;

    /** Phones in portrait are [COMPACT]; everything wider can afford more than one column. */
    val isAtLeastMedium: Boolean get() = this != COMPACT
}

/** Pure mapping from the Jetpack WindowManager size class (exposed for tests and previews). */
fun WindowSizeClass.toAedstWidthClass(): AedstWidthClass = when {
    isWidthAtLeastBreakpoint(WindowSizeClass.WIDTH_DP_EXPANDED_LOWER_BOUND) -> AedstWidthClass.EXPANDED
    isWidthAtLeastBreakpoint(WindowSizeClass.WIDTH_DP_MEDIUM_LOWER_BOUND) -> AedstWidthClass.MEDIUM
    else -> AedstWidthClass.COMPACT
}

/**
 * The width class of the current window (the app window, not the screen: split-screen, freeform and foldables are
 * reflected). Recomposes on resize, fold and rotation.
 */
@Composable
fun rememberAedstWidthClass(): AedstWidthClass = currentWindowAdaptiveInfoV2().windowSizeClass.toAedstWidthClass()
