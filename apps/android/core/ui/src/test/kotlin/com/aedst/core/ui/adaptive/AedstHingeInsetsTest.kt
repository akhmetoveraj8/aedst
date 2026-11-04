package com.aedst.core.ui.adaptive

import androidx.compose.ui.geometry.Rect
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class AedstHingeInsetsTest {

    @Test
    fun `no hinge leaves the window untouched`() {
        assertEquals(AedstHingeInsets.none, hingeSafeInsets(1800, 2200, emptyList(), emptyList()))
    }

    @Test
    fun `a vertical fold keeps content in the wider left half`() {
        // Window 1800 wide, 80px hinge at x=800..880: left half 800px, right half 920px -> right half is wider.
        val rightWider = hingeSafeInsets(1800, 2200, listOf(Rect(800f, 0f, 880f, 2200f)), emptyList())
        assertEquals(AedstHingeInsets(leftPx = 880), rightWider)

        // Hinge at x=1000..1080: left half 1000px, right half 720px -> left half is wider.
        val leftWider = hingeSafeInsets(1800, 2200, listOf(Rect(1000f, 0f, 1080f, 2200f)), emptyList())
        assertEquals(AedstHingeInsets(rightPx = 800), leftWider)
    }

    @Test
    fun `a tabletop fold keeps content in the taller half`() {
        // Hinge at y=1000..1080 of a 2200px window: top half 1000px, bottom half 1120px -> bottom half is taller.
        val bottomTaller = hingeSafeInsets(1800, 2200, emptyList(), listOf(Rect(0f, 1000f, 1800f, 1080f)))
        assertEquals(AedstHingeInsets(topPx = 1080), bottomTaller)

        val topTaller = hingeSafeInsets(1800, 2200, emptyList(), listOf(Rect(0f, 1400f, 1800f, 1480f)))
        assertEquals(AedstHingeInsets(bottomPx = 800), topTaller)
    }

    @Test
    fun `a hinge outside the window cannot produce negative insets`() {
        val insets = hingeSafeInsets(1000, 1000, listOf(Rect(1200f, 0f, 1300f, 1000f)), emptyList())

        assertEquals(AedstHingeInsets(rightPx = 0), insets)
    }
}
