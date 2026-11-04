package com.aedst.feature.tasks.presentation

import androidx.compose.runtime.Composable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.ui.res.stringResource
import com.aedst.core.ui.components.AedstBadge
import com.aedst.core.ui.components.AedstBadgeVariant
import com.aedst.feature.tasks.R
import com.aedst.feature.tasks.domain.TaskPriority
import com.aedst.feature.tasks.domain.TaskStatus
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

@Composable
internal fun TaskStatusBadge(status: TaskStatus) {
    val (text, variant) = when (status) {
        TaskStatus.TODO -> stringResource(R.string.tasks_status_todo) to AedstBadgeVariant.OUTLINE
        TaskStatus.IN_PROGRESS -> stringResource(R.string.tasks_status_in_progress) to AedstBadgeVariant.SECONDARY
        TaskStatus.DONE -> stringResource(R.string.tasks_status_done) to AedstBadgeVariant.DEFAULT
        TaskStatus.UNKNOWN -> stringResource(R.string.tasks_status_unknown) to AedstBadgeVariant.OUTLINE
    }
    AedstBadge(text = text, variant = variant)
}

@Composable
@ReadOnlyComposable
internal fun priorityLabel(priority: TaskPriority): String = stringResource(
    when (priority) {
        TaskPriority.LOW -> R.string.tasks_priority_low
        TaskPriority.MEDIUM -> R.string.tasks_priority_medium
        TaskPriority.HIGH -> R.string.tasks_priority_high
        TaskPriority.URGENT -> R.string.tasks_priority_urgent
        TaskPriority.UNKNOWN -> R.string.tasks_priority_unknown
    },
)

/** Localized medium date in the device time zone (java.time, desugared — no extra date library). */
internal fun Instant.formatDate(): String =
    DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withZone(ZoneId.systemDefault()).format(this)
