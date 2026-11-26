package com.aedst.core.ui.components.support

import com.aedst.core.ui.components.AedstAiStackFrame

// V8 "at fn (file:1:2)" / "at file:1:2" and Firefox/Safari "fn@file:1:2" (same patterns as web `ai-stack-trace.tsx`).
private val V8_FRAME = Regex("""^at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$""")
private val GECKO_FRAME = Regex("""^(.*?)@(.+?):(\d+):(\d+)$""")

/** Parses one trimmed stack line; a line in neither format keeps only [AedstAiStackFrame.raw]. */
internal fun parseAiStackFrame(raw: String): AedstAiStackFrame {
    val match = V8_FRAME.matchEntire(raw) ?: GECKO_FRAME.matchEntire(raw)
    val file = match?.groupValues?.get(2)?.takeIf { it.isNotEmpty() }
    val location = file ?: raw
    return AedstAiStackFrame(
        raw = raw,
        functionName = match?.groupValues?.get(1)?.takeIf { it.isNotEmpty() },
        file = file,
        line = match?.groupValues?.get(3)?.toIntOrNull(),
        column = match?.groupValues?.get(4)?.toIntOrNull(),
        isInternal = "node_modules" in location || location.startsWith("node:") || location.startsWith("internal/"),
    )
}
