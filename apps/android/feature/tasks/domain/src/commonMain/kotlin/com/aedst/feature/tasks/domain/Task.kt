package com.aedst.feature.tasks.domain

import kotlin.jvm.JvmInline
import kotlin.time.Instant

/**
 * A task's server id. A value class, so a task id cannot be passed where another `String` (an operation id, a page
 * token, a media id) is expected; it costs nothing at run time. Navigation keys and the wire keep the raw [value].
 */
@JvmInline
public value class TaskId(public val value: String) {
    override fun toString(): String = value
}

/**
 * [UNKNOWN] is a status this client does not know (an enum value added to the API after this build, or an unset field).
 * It is never defaulted to a real state: the UI shows a neutral "unknown" badge instead of pretending the task is open.
 */
public enum class TaskStatus { TODO, IN_PROGRESS, DONE, UNKNOWN }

/** [UNKNOWN] mirrors [TaskStatus.UNKNOWN] and is never offered when creating a task ([selectable]). */
public enum class TaskPriority {
    LOW,
    MEDIUM,
    HIGH,
    URGENT,
    UNKNOWN,
    ;

    public companion object {
        /** The priorities a user may pick; [UNKNOWN] is read-only. */
        public val selectable: List<TaskPriority> = entries - UNKNOWN
    }
}

/** Domain entity — no generated proto types leak above `data/`, mirrors `modules/tasks/domain` on the server. */
public data class Task(
    val id: TaskId,
    val title: String,
    val description: String,
    val status: TaskStatus,
    val priority: TaskPriority,
    val dueDate: Instant?,
    val createdAt: Instant?,
    val completedAt: Instant?,
    val version: Int,
) {
    public val isDone: Boolean get() = status == TaskStatus.DONE
}

public data class TaskPage(val tasks: List<Task>, val nextPageToken: String?, val totalCount: Int)

public data class NewTask(val title: String, val description: String, val priority: TaskPriority, val dueDate: Instant?)
