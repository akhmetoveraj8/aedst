package com.aedst.feature.tasks.presentation.list

import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import com.aedst.core.ui.adaptive.AedstWindowSizePreviews
import com.aedst.core.ui.theme.AedstTheme
import com.aedst.feature.tasks.domain.Task
import com.aedst.feature.tasks.domain.TaskPriority
import com.aedst.feature.tasks.domain.TaskStatus

/** Compact shows the list alone, medium also (one partition), expanded shows list and detail side by side. */
@AedstWindowSizePreviews
@Composable
private fun TaskListDetailWindowSizesPreview() {
    AedstTheme {
        TaskListDetailScreen(
            state = TaskListState(tasks = previewTasks, totalCount = previewTasks.size, isLoading = false),
            onIntent = {},
            onOpenTask = {},
            onCreateTask = {},
            detail = { taskId, _, _ -> Text("Task $taskId") },
        )
    }
}

@AedstWindowSizePreviews
@Composable
private fun TaskListScreenPreview() {
    AedstTheme {
        TaskListScreen(
            state = TaskListState(tasks = previewTasks, totalCount = previewTasks.size, isLoading = false),
            onIntent = {},
            onOpenTask = {},
            onCreateTask = {},
        )
    }
}

internal val previewTasks: List<Task> = listOf(
    previewTask("1", "Write the quarterly report", TaskStatus.IN_PROGRESS, TaskPriority.HIGH),
    previewTask("2", "Book the venue", TaskStatus.TODO, TaskPriority.MEDIUM),
    previewTask("3", "Send invoices", TaskStatus.DONE, TaskPriority.LOW),
)

internal fun previewTask(id: String, title: String, status: TaskStatus, priority: TaskPriority) = Task(
    id = id,
    title = title,
    description = "",
    status = status,
    priority = priority,
    dueDate = null,
    createdAt = null,
    completedAt = null,
    version = 1,
)
