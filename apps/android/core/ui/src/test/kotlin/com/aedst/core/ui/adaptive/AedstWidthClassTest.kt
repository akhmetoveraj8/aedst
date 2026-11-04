package com.aedst.core.ui.adaptive

import androidx.window.core.layout.WindowSizeClass
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class AedstWidthClassTest {

    @Test
    fun `a phone in portrait is compact`() {
        assertEquals(AedstWidthClass.COMPACT, sizeClass(widthDp = 360).toAedstWidthClass())
        assertEquals(AedstWidthClass.COMPACT, sizeClass(widthDp = 599).toAedstWidthClass())
    }

    @Test
    fun `a tablet in portrait or an unfolded foldable is medium`() {
        assertEquals(AedstWidthClass.MEDIUM, sizeClass(widthDp = 600).toAedstWidthClass())
        assertEquals(AedstWidthClass.MEDIUM, sizeClass(widthDp = 839).toAedstWidthClass())
    }

    @Test
    fun `a tablet in landscape is expanded, and so is anything wider`() {
        assertEquals(AedstWidthClass.EXPANDED, sizeClass(widthDp = 840).toAedstWidthClass())
        assertEquals(AedstWidthClass.EXPANDED, sizeClass(widthDp = 1200).toAedstWidthClass())
        assertEquals(AedstWidthClass.EXPANDED, sizeClass(widthDp = 1600).toAedstWidthClass())
    }

    @Test
    fun `the preview widths land in the class they are named after`() {
        assertEquals(AedstWidthClass.COMPACT, sizeClass(COMPACT_PREVIEW_WIDTH_DP).toAedstWidthClass())
        assertEquals(AedstWidthClass.MEDIUM, sizeClass(MEDIUM_PREVIEW_WIDTH_DP).toAedstWidthClass())
        assertEquals(AedstWidthClass.EXPANDED, sizeClass(EXPANDED_PREVIEW_WIDTH_DP).toAedstWidthClass())
    }

    @Test
    fun `only compact is below medium`() {
        assertFalse(AedstWidthClass.COMPACT.isAtLeastMedium)
        assertTrue(AedstWidthClass.MEDIUM.isAtLeastMedium)
        assertTrue(AedstWidthClass.EXPANDED.isAtLeastMedium)
    }

    private fun sizeClass(widthDp: Int) = WindowSizeClass(minWidthDp = widthDp, minHeightDp = 480)
}
