package com.aedst.core.ui.components.support

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import com.aedst.core.ui.components.AedstButton
import com.aedst.core.ui.components.AedstButtonVariant
import com.aedst.core.ui.components.AedstQuestionKind
import com.aedst.core.ui.components.AedstQuestionnaireChoice
import com.aedst.core.ui.components.AedstQuestionnaireQuestion
import com.aedst.core.ui.components.AedstQuestionnaireState
import com.aedst.core.ui.components.AedstTextField
import com.aedst.core.ui.theme.AedstSpacing

/** The current question: title (heading), description, choices or text input, and the required error. */
@Composable
internal fun QuestionnaireItem(
    state: AedstQuestionnaireState,
    question: AedstQuestionnaireQuestion,
    requiredError: String,
) {
    Column(verticalArrangement = Arrangement.spacedBy(AedstSpacing.md)) {
        Column(verticalArrangement = Arrangement.spacedBy(AedstSpacing.xs)) {
            Text(
                text = question.title,
                modifier = Modifier.semantics { heading() },
                style = MaterialTheme.typography.titleSmall,
            )
            question.description?.let {
                Text(
                    it,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        val answer = state.answerOf(question.name)
        when (question.kind) {
            AedstQuestionKind.TEXT -> AedstTextField(
                value = answer.firstOrNull().orEmpty(),
                onValueChange = { state.setText(question, it) },
                modifier = Modifier.fillMaxWidth(),
                label = question.inputLabel,
                isError = state.showsError,
            )
            else -> Column(
                modifier = Modifier.selectableGroup(),
                verticalArrangement = Arrangement.spacedBy(AedstSpacing.sm),
            ) {
                question.choices.forEach { choice ->
                    AedstQuestionnaireChoice(
                        label = choice.label,
                        selected = choice.value in answer,
                        onClick = { state.choose(question, choice.value) },
                        multiple = question.kind == AedstQuestionKind.MULTIPLE_CHOICE,
                        description = choice.description,
                        enabled = choice.enabled,
                    )
                }
            }
        }
        if (state.showsError) {
            Text(
                text = requiredError,
                modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.error,
            )
        }
    }
}

/** Button texts of [QuestionnaireActions]. */
@Immutable
internal data class QuestionnaireLabels(val previous: String, val skip: String, val next: String, val submit: String)

/**
 * Previous at the start; Skip (optional, not last) and Next or Submit at the end, as web's three-column grid.
 */
@Composable
internal fun QuestionnaireActions(
    state: AedstQuestionnaireState,
    question: AedstQuestionnaireQuestion,
    labels: QuestionnaireLabels,
    onSubmit: (Map<String, List<String>>) -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(AedstSpacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (!state.isFirst) {
            AedstButton(text = labels.previous, onClick = state::previous, variant = AedstButtonVariant.OUTLINE)
        }
        Spacer(Modifier.weight(1f))
        if (!question.required && !state.isLast) {
            AedstButton(text = labels.skip, onClick = state::skip, variant = AedstButtonVariant.OUTLINE)
        }
        if (state.isLast) {
            AedstButton(text = labels.submit, onClick = { if (state.submit()) onSubmit(state.answers) })
        } else {
            AedstButton(text = labels.next, onClick = { state.next() })
        }
    }
}
