package com.aedst.feature.search.presentation

import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString

/** Private-use markers the server wraps around matched terms in `SearchHit.snippet` (see search.proto). */
internal const val HIGHLIGHT_START = ''
internal const val HIGHLIGHT_END = ''

/**
 * Turns a marked snippet into an [AnnotatedString] with [highlight] applied to each match — native styling, no HTML
 * parsing. Markers are never rendered; an unbalanced start marker highlights to the end, a stray end is ignored.
 */
internal fun highlightSnippet(snippet: String, highlight: SpanStyle): AnnotatedString = buildAnnotatedString {
    var isOpen = false
    snippet.forEach { char ->
        when (char) {
            HIGHLIGHT_START -> if (!isOpen) {
                pushStyle(highlight)
                isOpen = true
            }
            HIGHLIGHT_END -> if (isOpen) {
                pop()
                isOpen = false
            }
            else -> append(char)
        }
    }
    if (isOpen) pop()
}
