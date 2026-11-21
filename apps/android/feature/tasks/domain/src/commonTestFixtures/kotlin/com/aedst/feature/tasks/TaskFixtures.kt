package com.aedst.feature.tasks

import com.aedst.core.common.AedstError
import com.aedst.core.common.Outcome
import com.aedst.core.network.NetworkMonitor
import com.aedst.feature.tasks.domain.NewTask
import com.aedst.feature.tasks.domain.Task
import com.aedst.feature.tasks.domain.TaskPage
import com.aedst.feature.tasks.domain.TaskPriority
import com.aedst.feature.tasks.domain.TaskRepository
import com.aedst.feature.tasks.domain.TaskStatus
import com.aedst.feature.tasks.domain.TaskWriteQueue
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow

internal fun domainTask(
    id: String,
    status: TaskStatus = TaskStatus.TODO,
    priority: TaskPriority = TaskPriority.MEDIUM,
    title: String = "Task $id",
) = Task(
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

/** [TaskRepository] whose every answer is set by the test; records what it was asked. */
internal class ScriptedTaskRepository : TaskRepository {
    var pages: Map<String?, TaskPage> = emptyMap()
    var getResult: Outcome<Task> = Outcome.Failure(AedstError.NotFound())
    var createResult: Outcome<Task> = Outcome.Failure(AedstError.Unknown("unscripted"))
    var completeResult: Outcome<Task> = Outcome.Failure(AedstError.Unknown("unscripted"))
    var reopenResult: Outcome<Task> = Outcome.Failure(AedstError.Unknown("unscripted"))
    var deleteResult: Outcome<Unit> = Outcome.Success(Unit)

    val created = mutableListOf<NewTask>()

    /** The `Idempotency-Key` of every create / complete call, in order. */
    val createKeys = mutableListOf<String>()
    val completeKeys = mutableListOf<String>()
    val completed = mutableListOf<String>()
    val reopened = mutableListOf<String>()
    val deleted = mutableListOf<String>()

    override suspend fun list(pageToken: String?): Outcome<TaskPage> = Outcome.Success(pages.getValue(pageToken))

    override suspend fun get(id: String): Outcome<Task> = getResult

    override suspend fun create(task: NewTask, idempotencyKey: String): Outcome<Task> {
        created += task
        createKeys += idempotencyKey
        return createResult
    }

    override suspend fun complete(id: String, idempotencyKey: String): Outcome<Task> {
        completed += id
        completeKeys += idempotencyKey
        return completeResult
    }

    override suspend fun reopen(id: String): Outcome<Task> {
        reopened += id
        return reopenResult
    }

    override suspend fun delete(id: String): Outcome<Unit> {
        deleted += id
        return deleteResult
    }
}

/** Records what the offline queue was asked to hold; `failure` makes the next queueing throw (a full disk). */
internal class FakeTaskWriteQueue : TaskWriteQueue {
    data class Queued(val operationId: String, val task: NewTask?, val completedTaskId: String?)

    val queued = mutableListOf<Queued>()
    var failure: Throwable? = null

    override suspend fun queueCreate(task: NewTask, operationId: String) {
        failure?.let { throw it }
        queued += Queued(operationId, task, null)
    }

    override suspend fun queueComplete(taskId: String, operationId: String) {
        failure?.let { throw it }
        queued += Queued(operationId, null, taskId)
    }
}

internal class FakeNetworkMonitor(online: Boolean = true) : NetworkMonitor {
    val state = MutableStateFlow(online)
    override val isOnline: Flow<Boolean> = state
}
