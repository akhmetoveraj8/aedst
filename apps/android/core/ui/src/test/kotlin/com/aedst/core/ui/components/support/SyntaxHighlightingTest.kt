package com.aedst.core.ui.components.support

import com.aedst.core.ui.theme.AedstLightExtendedColors
import dev.snipme.highlights.model.SyntaxLanguage
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/** The mapping from the Highlights library's token kinds to the kit's `syntax*` tokens (plain JVM). */
class SyntaxHighlightingTest {

    @Test
    fun `web-style language names resolve, unknown ones stay plain`() {
        assertEquals(SyntaxLanguage.KOTLIN, syntaxLanguageOf("kotlin"))
        assertEquals(SyntaxLanguage.KOTLIN, syntaxLanguageOf(" KT "))
        assertEquals(SyntaxLanguage.TYPESCRIPT, syntaxLanguageOf("tsx"))
        assertEquals(SyntaxLanguage.SHELL, syntaxLanguageOf("bash"))
        assertNull(syntaxLanguageOf("yaml"))
        assertNull(syntaxLanguageOf(null))
        assertNull(syntaxLanguageOf("default"))
    }

    @Test
    fun `kotlin keywords, numbers, strings and comments become spans of their kind`() {
        val code = "val answer = 42 // the \"answer\"\nval name = \"Ada\""
        val spans = analyzeSyntax(code, SyntaxLanguage.KOTLIN)

        fun textOf(kind: SyntaxKind) = spans.filter { it.kind == kind }.map { code.substring(it.start, it.end) }
        assertTrue("val" in textOf(SyntaxKind.KEYWORD), "keywords: ${textOf(SyntaxKind.KEYWORD)}")
        assertTrue("42" in textOf(SyntaxKind.NUMBER), "numbers: ${textOf(SyntaxKind.NUMBER)}")
        assertTrue(textOf(SyntaxKind.STRING).any { "Ada" in it }, "strings: ${textOf(SyntaxKind.STRING)}")
        assertTrue(textOf(SyntaxKind.COMMENT).any { it.startsWith("//") }, "comments: ${textOf(SyntaxKind.COMMENT)}")
        assertTrue(spans.all { it.start in 0 until it.end && it.end <= code.length })
    }

    @Test
    fun `highlighted text colours each span with its token and ignores stale ranges`() {
        val colors = AedstLightExtendedColors
        val text = highlightedText(
            code = "val x",
            spans = listOf(SyntaxSpan(0, 3, SyntaxKind.KEYWORD), SyntaxSpan(2, 40, SyntaxKind.STRING)),
            colors = colors,
        )

        assertEquals("val x", text.text)
        assertEquals(listOf(colors.syntaxKeyword), text.spanStyles.map { it.item.color })
    }
}
