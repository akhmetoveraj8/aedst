package com.aedst.feature.tasks.data

import com.aedst.core.network.toTimestamp
import com.aedst.feature.tasks.domain.NewTask
import com.aedst.tasks.v1.CreateTaskRequest
import com.aedst.tasks.v1.createTaskRequest

/** The one place a [NewTask] becomes a wire request: used by the direct call and by the queued (outbox) one. */
internal fun NewTask.toRequest(): CreateTaskRequest = createTaskRequest {
    title = this@toRequest.title.trim()
    description = this@toRequest.description.trim()
    priority = this@toRequest.priority.toProto()
    this@toRequest.dueDate?.let { dueDate = it.toTimestamp() }
}
