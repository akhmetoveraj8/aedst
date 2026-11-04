package com.aedst.core.ui.theme

import androidx.compose.foundation.shape.RoundedCornerShape

/** Shapes built from the generated [AedstRadius] scale (tokens: packages/design-tokens). */
object AedstShapesScale {
    val small = RoundedCornerShape(AedstRadius.sm)
    val medium = RoundedCornerShape(AedstRadius.md)
    val large = RoundedCornerShape(AedstRadius.lg)
    val extraLarge = RoundedCornerShape(AedstRadius.xl)
    val pill = RoundedCornerShape(AedstRadius.full)
}
