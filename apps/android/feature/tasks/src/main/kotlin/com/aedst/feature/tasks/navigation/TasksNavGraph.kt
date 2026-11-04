package com.aedst.feature.tasks.navigation

import androidx.navigation3.runtime.EntryProviderScope
import androidx.navigation3.runtime.NavKey
import com.aedst.core.navigation.AedstNavGraph
import com.aedst.core.navigation.AedstNavigator
import com.aedst.core.navigation.MediaDetailKey
import com.aedst.core.navigation.TaskCreateKey
import com.aedst.core.navigation.TaskDetailKey
import com.aedst.core.navigation.TaskListKey
import com.aedst.feature.tasks.presentation.create.TaskCreateRoute
import com.aedst.feature.tasks.presentation.detail.TaskDetailRoute
import com.aedst.feature.tasks.presentation.list.TaskListRoute

/**
 * feature/tasks' public boundary. Opening an attachment navigates to `MediaDetailKey` (defined in core/navigation) —
 * feature/media registers its entry — so this module never depends on feature/media.
 */
class TasksNavGraph : AedstNavGraph {
    override fun register(scope: EntryProviderScope<NavKey>, navigator: AedstNavigator) {
        scope.entry<TaskListKey> {
            TaskListRoute(
                onOpenTask = { id -> navigator.navigate(TaskDetailKey(id)) },
                onCreateTask = { navigator.navigate(TaskCreateKey) },
                onOpenMedia = { id -> navigator.navigate(MediaDetailKey(id)) },
            )
        }
        scope.entry<TaskDetailKey> { key ->
            TaskDetailRoute(
                taskId = key.taskId,
                onBack = navigator::back,
                onOpenMedia = { id -> navigator.navigate(MediaDetailKey(id)) },
            )
        }
        scope.entry<TaskCreateKey> {
            TaskCreateRoute(
                onBack = navigator::back,
                // The created task replaces the form, so back from the detail returns to the list.
                onCreated = { id -> navigator.replaceTop(TaskDetailKey(id)) },
            )
        }
    }
}
