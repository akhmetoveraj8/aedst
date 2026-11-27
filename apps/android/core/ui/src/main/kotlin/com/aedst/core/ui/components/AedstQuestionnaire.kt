package com.aedst.core.ui.components

import android.content.res.Configuration
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.toggleable
import androidx.compose.material3.Checkbox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.Saver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.progressBarRangeInfo
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.tooling.preview.Preview
import com.aedst.core.ui.R
import com.aedst.core.ui.components.support.QuestionnaireActions
import com.aedst.core.ui.components.support.QuestionnaireItem
import com.aedst.core.ui.components.support.QuestionnaireLabels
import com.aedst.core.ui.theme.AedstHairline
import com.aedst.core.ui.theme.AedstShapesScale
import com.aedst.core.ui.theme.AedstSpacing
import com.aedst.core.ui.theme.AedstTheme

/** How a question is answered: one choice (radio), several choices (checkboxes) or free text. */
enum class AedstQuestionKind { SINGLE_CHOICE, MULTIPLE_CHOICE, TEXT }

/** One option of a choice question, rendered as an [AedstQuestionnaireChoice] (web `QuestionnaireChoice` data). */
@Immutable
data class AedstQuestionnaireOption(
    val value: String,
    val label: String,
    val description: String? = null,
    val enabled: Boolean = true,
)

/**
 * One step of an [AedstQuestionnaire] (web `QuestionnaireItem` with its title, description, choices or input).
 * [inputLabel] names the text field of a [AedstQuestionKind.TEXT] question.
 */
@Immutable
data class AedstQuestionnaireQuestion(
    val name: String,
    val title: String,
    val description: String? = null,
    val kind: AedstQuestionKind = AedstQuestionKind.SINGLE_CHOICE,
    val choices: List<AedstQuestionnaireOption> = emptyList(),
    val required: Boolean = false,
    val inputLabel: String? = null,
)

/**
 * Progress and answers of an [AedstQuestionnaire], one question at a time. Answers are lists of choice values (one
 * element for single choice and text). [next] refuses to leave a required question without an answer and sets
 * [showsError] instead. Survives configuration changes and process death through [rememberAedstQuestionnaireState].
 */
@Stable
class AedstQuestionnaireState(
    val questions: List<AedstQuestionnaireQuestion>,
    initialIndex: Int = 0,
    initialAnswers: Map<String, List<String>> = emptyMap(),
) {
    private val answerMap = mutableStateMapOf<String, List<String>>().apply { putAll(initialAnswers) }

    var currentIndex by mutableIntStateOf(initialIndex.coerceIn(0, (questions.size - 1).coerceAtLeast(0)))
        private set

    /** True after [next] or [submit] was refused because the current required question has no answer. */
    var showsError by mutableStateOf(false)
        private set

    val current: AedstQuestionnaireQuestion? get() = questions.getOrNull(currentIndex)
    val isFirst: Boolean get() = currentIndex == 0
    val isLast: Boolean get() = currentIndex >= questions.size - 1

    /** A snapshot of every answer given so far, by question name. */
    val answers: Map<String, List<String>> get() = answerMap.toMap()

    fun answerOf(name: String): List<String> = answerMap[name].orEmpty()

    /** Records [value] for a single-choice question, or toggles it for a multiple-choice one. */
    fun choose(question: AedstQuestionnaireQuestion, value: String) {
        val previous = answerOf(question.name)
        answerMap[question.name] = when (question.kind) {
            AedstQuestionKind.MULTIPLE_CHOICE -> if (value in previous) previous - value else previous + value
            else -> listOf(value)
        }
        showsError = false
    }

    fun setText(question: AedstQuestionnaireQuestion, text: String) {
        answerMap[question.name] = if (text.isEmpty()) emptyList() else listOf(text)
        showsError = false
    }

    /** Moves to the next question; false (and [showsError]) when the current one is required and unanswered. */
    fun next(): Boolean {
        if (!validate()) return false
        if (!isLast) currentIndex++
        return true
    }

    fun previous() {
        showsError = false
        if (!isFirst) currentIndex--
    }

    /** Leaves an optional question without an answer. */
    fun skip() {
        current?.let { answerMap.remove(it.name) }
        showsError = false
        if (!isLast) currentIndex++
    }

    /** True when the current question may be left, i.e. the questionnaire may be submitted from the last step. */
    fun submit(): Boolean = validate()

    private fun validate(): Boolean {
        val question = current ?: return true
        val ok = !question.required || answerOf(question.name).any { it.isNotBlank() }
        showsError = !ok
        return ok
    }

    internal companion object {
        fun saver(questions: List<AedstQuestionnaireQuestion>) = Saver<AedstQuestionnaireState, Any>(
            save = { state ->
                arrayListOf<Any>(state.currentIndex, HashMap(state.answers.mapValues { ArrayList(it.value) }))
            },
            restore = { saved ->
                val list = saved as List<*>
                @Suppress("UNCHECKED_CAST")
                AedstQuestionnaireState(questions, list[0] as Int, list[1] as Map<String, List<String>>)
            },
        )
    }
}

/** Remembers an [AedstQuestionnaireState] for [questions], saved across configuration changes and process death. */
@Composable
fun rememberAedstQuestionnaireState(questions: List<AedstQuestionnaireQuestion>): AedstQuestionnaireState =
    rememberSaveable(questions, saver = AedstQuestionnaireState.saver(questions)) { AedstQuestionnaireState(questions) }

/**
 * A step-by-step questionnaire, mirroring web's `questionnaire.tsx`: progress ("Question 2 of 5"), the current
 * question (title as a heading, description, choices or a text field, the error), and Previous / Skip / Next /
 * Submit. Skip is offered for optional questions that are not the last; Submit replaces Next on the last step and
 * calls [onSubmit] with every answer. Labels default to the kit's translated strings.
 */
@Composable
fun AedstQuestionnaire(
    state: AedstQuestionnaireState,
    onSubmit: (Map<String, List<String>>) -> Unit,
    modifier: Modifier = Modifier,
    showProgress: Boolean = true,
    previousLabel: String = stringResource(R.string.aedst_a11y_previous),
    nextLabel: String = stringResource(R.string.aedst_a11y_next),
    skipLabel: String = stringResource(R.string.aedst_action_skip),
    submitLabel: String = stringResource(R.string.aedst_action_submit),
    requiredError: String = stringResource(R.string.aedst_required),
) {
    val question = state.current ?: return
    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(AedstSpacing.lg)) {
        if (showProgress) AedstQuestionnaireProgress(current = state.currentIndex + 1, total = state.questions.size)
        QuestionnaireItem(state = state, question = question, requiredError = requiredError)
        QuestionnaireActions(
            state = state,
            question = question,
            labels = QuestionnaireLabels(previousLabel, skipLabel, nextLabel, submitLabel),
            onSubmit = onSubmit,
        )
    }
}

/** "Question [current] of [total]" (web `QuestionnaireProgress`), exposed as a progress bar with that value text. */
@Composable
fun AedstQuestionnaireProgress(current: Int, total: Int, modifier: Modifier = Modifier) {
    val text = stringResource(R.string.aedst_a11y_question_progress, current, total)
    Text(
        text = text,
        modifier = modifier.semantics {
            progressBarRangeInfo = ProgressBarRangeInfo(current.toFloat(), 0f..total.coerceAtLeast(1).toFloat())
            stateDescription = text
        },
        style = MaterialTheme.typography.labelMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
}

/**
 * One answer option (web `QuestionnaireChoice`): a bordered row with a radio button ([multiple] false) or a checkbox,
 * the [label] and an optional [description]. The whole row is the 48dp target and reports its selection.
 */
@Composable
fun AedstQuestionnaireChoice(
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    multiple: Boolean = false,
    description: String? = null,
    enabled: Boolean = true,
) {
    val scheme = MaterialTheme.colorScheme
    val interaction = if (multiple) {
        Modifier.toggleable(value = selected, enabled = enabled, role = Role.Checkbox, onValueChange = { onClick() })
    } else {
        Modifier.selectable(selected = selected, enabled = enabled, role = Role.RadioButton, onClick = onClick)
    }
    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = AedstShapesScale.medium,
        color = if (selected) scheme.surfaceVariant else scheme.surface,
        contentColor = if (enabled) scheme.onSurface else scheme.onSurfaceVariant,
        border = BorderStroke(
            AedstHairline,
            if (selected) scheme.primary.copy(alpha = SELECTED_BORDER) else scheme.outline,
        ),
    ) {
        Row(
            modifier = interaction.heightIn(
                min = AedstSpacing.massive,
            ).padding(horizontal = AedstSpacing.md, vertical = AedstSpacing.xs),
            horizontalArrangement = Arrangement.spacedBy(AedstSpacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (multiple) {
                Checkbox(checked = selected, onCheckedChange = null, enabled = enabled)
            } else {
                RadioButton(selected = selected, onClick = null, enabled = enabled)
            }
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(AedstSpacing.xxs)) {
                Text(label, style = MaterialTheme.typography.bodyMedium)
                if (description != null) {
                    Text(description, style = MaterialTheme.typography.bodySmall, color = scheme.onSurfaceVariant)
                }
            }
        }
    }
}

private const val SELECTED_BORDER = 0.4f

@Preview(name = "Light", showBackground = true)
@Preview(name = "Dark", uiMode = Configuration.UI_MODE_NIGHT_YES, showBackground = true)
@Composable
private fun AedstQuestionnairePreview() {
    val questions = listOf(
        AedstQuestionnaireQuestion(
            name = "role",
            title = "What best describes your role?",
            description = "Pick one option.",
            required = true,
            choices = listOf(
                AedstQuestionnaireOption("engineer", "Engineer", "Builds and ships software"),
                AedstQuestionnaireOption("designer", "Designer"),
            ),
        ),
        AedstQuestionnaireQuestion(name = "notes", title = "Anything else?", kind = AedstQuestionKind.TEXT),
    )
    AedstTheme {
        Surface {
            AedstQuestionnaire(
                state = rememberAedstQuestionnaireState(questions),
                onSubmit = {},
                modifier = Modifier.padding(AedstSpacing.lg),
            )
        }
    }
}
