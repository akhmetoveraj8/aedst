package com.aedst.feature.search.presentation

import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.font.FontWeight
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class SnippetHighlighterTest {

    private val bold = SpanStyle(fontWeight = FontWeight.Bold)

    @Test
    fun `markers become styled ranges and are not rendered`() {
        val result = highlightSnippet("buy milk and eggs", bold)

        assertEquals("buy milk and eggs", result.text)
        val ranges = result.spanStyles.map { it.start to it.end }
        assertEquals(listOf(4 to 8, 13 to 17), ranges)
    }

    @Test
    fun `unbalanced markers never crash`() {
        assertEquals("abc", highlightSnippet("abc", bold).text)
        assertEquals(listOf(2 to 3), highlightSnippet("abc", bold).spanStyles.map { it.start to it.end })
    }
}
