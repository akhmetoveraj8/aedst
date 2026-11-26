package com.aedst.core.ui.components.support

import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.listSaver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue

/**
 * A file attached to an `AedstAiPromptInput` draft. The screen fills it from the system picker result (a content
 * [uri], the display [name], the [mimeType]); the kit never reads the file.
 */
@Immutable
data class AedstAiPromptInputFile(val uri: String, val name: String, val mimeType: String? = null)

/**
 * The draft of an `AedstAiPromptInput` (web `usePromptDraft`): the [text] and the attached [files]. It survives
 * configuration changes and process death ([rememberAedstAiPromptInputState]). With [multiple] false a new pick
 * replaces the attached file.
 */
@Stable
class AedstAiPromptInputState(
    initialText: String = "",
    initialFiles: List<AedstAiPromptInputFile> = emptyList(),
    val multiple: Boolean = true,
) {
    var text: String by mutableStateOf(initialText)

    private val attached = mutableStateListOf<AedstAiPromptInputFile>().apply { addAll(initialFiles) }

    /** The attached files, in pick order. */
    val files: List<AedstAiPromptInputFile> get() = attached

    /** Adds picked files (or replaces the one file when [multiple] is false). */
    fun addFiles(picked: List<AedstAiPromptInputFile>) {
        if (picked.isEmpty()) return
        if (!multiple) attached.clear()
        attached.addAll(if (multiple) picked else picked.take(1))
    }

    fun removeFile(file: AedstAiPromptInputFile) {
        attached.remove(file)
    }

    /** True when not [busy] and there is text or a file (web `canSubmit`). */
    fun canSubmit(busy: Boolean): Boolean = !busy && (text.isNotBlank() || attached.isNotEmpty())

    /** Hands the trimmed text and the files to [onSubmit] and clears the draft; does nothing when it cannot submit. */
    fun submit(busy: Boolean, onSubmit: (String, List<AedstAiPromptInputFile>) -> Unit) {
        if (!canSubmit(busy)) return
        onSubmit(text.trim(), attached.toList())
        text = ""
        attached.clear()
    }

    companion object {
        private const val FIELDS = 3

        /** Saves the text, `multiple` and each file as three strings. */
        val Saver = listSaver<AedstAiPromptInputState, String>(
            save = { state ->
                listOf(state.text, state.multiple.toString()) +
                    state.files.flatMap { listOf(it.uri, it.name, it.mimeType.orEmpty()) }
            },
            restore = { saved ->
                val files = saved.drop(2).chunked(FIELDS).filter { it.size == FIELDS }.map { (uri, name, type) ->
                    AedstAiPromptInputFile(uri, name, type.ifEmpty { null })
                }
                AedstAiPromptInputState(saved[0], files, saved[1].toBoolean())
            },
        )
    }
}

/** A saveable [AedstAiPromptInputState]. */
@Composable
fun rememberAedstAiPromptInputState(multiple: Boolean = true): AedstAiPromptInputState =
    rememberSaveable(saver = AedstAiPromptInputState.Saver) { AedstAiPromptInputState(multiple = multiple) }
