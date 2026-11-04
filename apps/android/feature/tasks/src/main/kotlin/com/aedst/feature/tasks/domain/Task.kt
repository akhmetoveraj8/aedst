package com.aedst.feature.tasks.domain

import java.time.Instant

/**
 * [UNKNOWN] is a status this client does not know (an enum value added to the API after this build, or an unset field).
 * It is never defaulted to a real state: the UI shows a neutral "unknown" badge instead of pretending the task is open.
 */
enum class TaskStatus { TODO, IN_PROGRESS, DONE, UNKNOWN }

/** [UNKNOWN] mirrors [TaskStatus.UNKNOWN] and is never offered when creating a task ([selectable]). */
enum class TaskPriority {
    LOW,
    MEDIUM,
    HIGH,
    URGENT,
    UNKNOWN,
    ;

    companion object {
        /** The priorities a user may pick; [UNKNOWN] is read-only. */
        val selectable: List<TaskPriority> = entries - UNKNOWN
    }
}

/** Domain entity — no generated proto types leak above `data/`, mirrors `modules/tasks/domain` on the server. */
data class Task(
    val id: String,
    val title: String,
    val description: String,
    val status: TaskStatus,
    val priority: TaskPriority,
    val dueDate: Instant?,
    val createdAt: Instant?,
    val completedAt: Instant?,
    val version: Int,
) {
    val isDone: Boolean get() = status == TaskStatus.DONE
}

data class TaskPage(val tasks: List<Task>, val nextPageToken: String?, val totalCount: Int)

data class NewTask(val title: String, val description: String, val priority: TaskPriority, val dueDate: Instant?)
