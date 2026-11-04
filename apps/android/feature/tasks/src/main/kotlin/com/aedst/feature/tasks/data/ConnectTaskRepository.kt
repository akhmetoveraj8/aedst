package com.aedst.feature.tasks.data

import com.aedst.core.common.Outcome
import com.aedst.core.common.runCatchingOutcome
import com.aedst.core.network.idempotencyHeaders
import com.aedst.core.network.rpc
import com.aedst.core.network.toInstantOrNull
import com.aedst.feature.tasks.domain.NewTask
import com.aedst.feature.tasks.domain.Task
import com.aedst.feature.tasks.domain.TaskPage
import com.aedst.feature.tasks.domain.TaskPriority
import com.aedst.feature.tasks.domain.TaskRepository
import com.aedst.feature.tasks.domain.TaskStatus
import com.aedst.tasks.v1.TasksServiceClientInterface
import com.aedst.tasks.v1.completeTaskRequest
import com.aedst.tasks.v1.deleteTaskRequest
import com.aedst.tasks.v1.getTaskRequest
import com.aedst.tasks.v1.listTasksRequest
import com.aedst.tasks.v1.reopenTaskRequest
import javax.inject.Inject
import com.aedst.tasks.v1.Task as ProtoTask
import com.aedst.tasks.v1.TaskPriority as ProtoTaskPriority
import com.aedst.tasks.v1.TaskStatus as ProtoTaskStatus

internal class ConnectTaskRepository @Inject constructor(private val client: TasksServiceClientInterface) :
    TaskRepository {

    override suspend fun list(pageToken: String?): Outcome<TaskPage> = runCatchingOutcome {
        val response = rpc {
            client.listTasks(
                listTasksRequest {
                    pageSize = PAGE_SIZE
                    pageToken?.let { this.pageToken = it }
                },
            )
        }
        TaskPage(
            tasks = response.tasksList.map { it.toDomain() },
            nextPageToken = response.nextPageToken.takeIf(String::isNotEmpty),
            totalCount = response.totalCount,
        )
    }

    override suspend fun get(id: String): Outcome<Task> = runCatchingOutcome {
        rpc { client.getTask(getTaskRequest { this.id = id }) }.task.toDomain()
    }

    // Every write carries an Idempotency-Key: OkHttp (retryOnConnectionFailure) re-sends a POST whose connection broke,
    // and a retry of a write whose response was lost must not apply it twice. The default is a fresh UUID per call;
    // the offline path passes the key it also queues the operation under.
    override suspend fun create(task: NewTask, idempotencyKey: String): Outcome<Task> = runCatchingOutcome {
        rpc { client.createTask(task.toRequest(), idempotencyHeaders(idempotencyKey)) }.task.toDomain()
    }

    override suspend fun complete(id: String, idempotencyKey: String): Outcome<Task> = runCatchingOutcome {
        rpc { client.completeTask(completeTaskRequest { this.id = id }, idempotencyHeaders(idempotencyKey)) }
            .task.toDomain()
    }

    override suspend fun reopen(id: String): Outcome<Task> = runCatchingOutcome {
        rpc { client.reopenTask(reopenTaskRequest { this.id = id }, idempotencyHeaders()) }.task.toDomain()
    }

    override suspend fun delete(id: String): Outcome<Unit> = runCatchingOutcome {
        rpc { client.deleteTask(deleteTaskRequest { this.id = id }, idempotencyHeaders()) }
        Unit
    }

    private companion object {
        const val PAGE_SIZE = 20
    }
}

internal fun ProtoTask.toDomain(): Task = Task(
    id = id,
    title = title,
    description = description,
    status = status.toDomain(),
    priority = priority.toDomain(),
    dueDate = if (hasDueDate()) dueDate.toInstantOrNull() else null,
    createdAt = if (hasCreatedAt()) createdAt.toInstantOrNull() else null,
    completedAt = if (hasCompletedAt()) completedAt.toInstantOrNull() else null,
    version = version,
)

// The mappers below are exhaustive on purpose (no `else`): a value added to the proto enum fails compilation here
// instead of silently becoming a real state. UNSPECIFIED / UNRECOGNIZED (a newer server) become UNKNOWN, which the UI
// renders as "unknown".
internal fun ProtoTaskStatus.toDomain(): TaskStatus = when (this) {
    ProtoTaskStatus.TASK_STATUS_TODO -> TaskStatus.TODO
    ProtoTaskStatus.TASK_STATUS_IN_PROGRESS -> TaskStatus.IN_PROGRESS
    ProtoTaskStatus.TASK_STATUS_DONE -> TaskStatus.DONE
    ProtoTaskStatus.TASK_STATUS_UNSPECIFIED, ProtoTaskStatus.UNRECOGNIZED -> TaskStatus.UNKNOWN
}

internal fun ProtoTaskPriority.toDomain(): TaskPriority = when (this) {
    ProtoTaskPriority.TASK_PRIORITY_LOW -> TaskPriority.LOW
    ProtoTaskPriority.TASK_PRIORITY_MEDIUM -> TaskPriority.MEDIUM
    ProtoTaskPriority.TASK_PRIORITY_HIGH -> TaskPriority.HIGH
    ProtoTaskPriority.TASK_PRIORITY_URGENT -> TaskPriority.URGENT
    ProtoTaskPriority.TASK_PRIORITY_UNSPECIFIED, ProtoTaskPriority.UNRECOGNIZED -> TaskPriority.UNKNOWN
}

/** UNKNOWN is never sent as a real priority: it becomes UNSPECIFIED so server validation rejects it explicitly. */
internal fun TaskPriority.toProto(): ProtoTaskPriority = when (this) {
    TaskPriority.LOW -> ProtoTaskPriority.TASK_PRIORITY_LOW
    TaskPriority.MEDIUM -> ProtoTaskPriority.TASK_PRIORITY_MEDIUM
    TaskPriority.HIGH -> ProtoTaskPriority.TASK_PRIORITY_HIGH
    TaskPriority.URGENT -> ProtoTaskPriority.TASK_PRIORITY_URGENT
    TaskPriority.UNKNOWN -> ProtoTaskPriority.TASK_PRIORITY_UNSPECIFIED
}
