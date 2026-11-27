package com.aedst.core.ui.a11y

import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.Dp
import com.aedst.core.ui.theme.AedstSpacing

/** Minimum size of an interactive element (Material and WCAG 2.5.8 guidance for touch: 48dp). */
val AedstMinTouchTarget: Dp = AedstSpacing.massive

/** At least [AedstMinTouchTarget] tall; put it after `clickable` so the whole row is the hit area. */
fun Modifier.aedstMinTouchHeight(): Modifier = heightIn(min = AedstMinTouchTarget)

/** At least [AedstMinTouchTarget] wide and tall, for icon-only and square controls. */
fun Modifier.aedstMinTouchSize(): Modifier = sizeIn(minWidth = AedstMinTouchTarget, minHeight = AedstMinTouchTarget)
