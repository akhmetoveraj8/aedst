package com.aedst.feature.tasks.presentation.list

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.adaptive.ExperimentalMaterial3AdaptiveApi
import androidx.compose.material3.adaptive.layout.AnimatedPane
import androidx.compose.material3.adaptive.layout.ListDetailPaneScaffoldRole
import androidx.compose.material3.adaptive.navigation.NavigableListDetailPaneScaffold
import androidx.compose.material3.adaptive.navigation.rememberListDetailPaneScaffoldNavigator
import androidx.compose.runtime.Composable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import com.aedst.feature.tasks.R
import kotlinx.coroutines.launch

/**
 * The tasks screen for every window size.
 *
 * - **One pane** (phones, medium windows without a fold): the list fills the window and a tap hands the task to
 *   [onOpenTask], which pushes the detail onto the app's Navigation 3 back stack as before, so deep links, the system
 *   back button and the saved state of the stack are unchanged.
 * - **Two panes** (expanded windows, or a foldable whose fold separates the window): list and detail sit side by side
 *   and a tap swaps the detail in place. The Material 3 pane scaffold positions the panes around a separating hinge
 *   (`HingePolicy.AvoidSeparating`) and handles tabletop posture. If the window shrinks to one pane while a task is
 *   selected, the scaffold shows that detail alone and back returns to the list.
 *
 * [detail] draws one task; it receives a close callback and whether it fills the window.
 */
@OptIn(ExperimentalMaterial3AdaptiveApi::class)
@Composable
internal fun TaskListDetailScreen(
    state: TaskListState,
    onIntent: (TaskListIntent) -> Unit,
    onOpenTask: (String) -> Unit,
    onCreateTask: () -> Unit,
    detail: @Composable (taskId: String, onClose: () -> Unit, isSinglePane: Boolean) -> Unit,
) {
    val navigator = rememberListDetailPaneScaffoldNavigator<String>()
    val scope = rememberCoroutineScope()
    val isSinglePane = navigator.scaffoldDirective.maxHorizontalPartitions <= 1
    val selected = navigator.currentDestination
        ?.takeIf { it.pane == ListDetailPaneScaffoldRole.Detail }
        ?.contentKey

    NavigableListDetailPaneScaffold(
        navigator = navigator,
        listPane = {
            AnimatedPane {
                TaskListScreen(
                    state = state,
                    onIntent = onIntent,
                    onOpenTask = { id ->
                        if (isSinglePane) {
                            onOpenTask(id)
                        } else {
                            scope.launch { navigator.navigateTo(ListDetailPaneScaffoldRole.Detail, id) }
                        }
                    },
                    onCreateTask = onCreateTask,
                    selectedTaskId = selected.takeUnless { isSinglePane },
                )
            }
        },
        detailPane = {
            AnimatedPane {
                if (selected == null) {
                    NoTaskSelected()
                } else {
                    detail(selected, { scope.launch { navigator.navigateBack() } }, isSinglePane)
                }
            }
        },
    )
}

@Composable
private fun NoTaskSelected() {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Text(stringResource(R.string.tasks_select_prompt), style = MaterialTheme.typography.bodyLarge)
    }
}
