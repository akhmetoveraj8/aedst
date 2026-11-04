package com.aedst.core.ui.adaptive

import androidx.compose.ui.tooling.preview.Preview

/**
 * Multi-preview for the three window width classes (compact phone, medium tablet portrait / unfolded foldable,
 * expanded tablet landscape). Put it on a screen's preview next to light/dark so adaptive layouts are reviewed at every
 * size in the IDE.
 */
@Preview(name = "Compact", widthDp = COMPACT_PREVIEW_WIDTH_DP, heightDp = 800, showBackground = true)
@Preview(name = "Medium", widthDp = MEDIUM_PREVIEW_WIDTH_DP, heightDp = 900, showBackground = true)
@Preview(name = "Expanded", widthDp = EXPANDED_PREVIEW_WIDTH_DP, heightDp = 700, showBackground = true)
annotation class AedstWindowSizePreviews

internal const val COMPACT_PREVIEW_WIDTH_DP = 360
internal const val MEDIUM_PREVIEW_WIDTH_DP = 700
internal const val EXPANDED_PREVIEW_WIDTH_DP = 1000
