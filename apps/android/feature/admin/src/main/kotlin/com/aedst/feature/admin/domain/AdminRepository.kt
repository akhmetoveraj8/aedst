package com.aedst.feature.admin.domain

import com.aedst.core.common.Outcome
import java.time.Instant

data class AdminOverview(
    val tasksTotal: Long,
    val tasksDone: Long,
    val tasksOverdue: Long,
    val mediaTotal: Long,
    val mediaBytes: Long,
    val pushDevices: Long,
    val outboxLagSeconds: Long,
    val jobsPending: Long,
)

data class AdminTaskRow(val id: String, val ownerId: String, val title: String, val isDone: Boolean)

data class AuditRow(
    val id: String,
    val actorId: String,
    val action: String,
    val target: String,
    val reason: String,
    val createdAt: Instant?,
)

data class Page<T>(val items: List<T>, val nextPageToken: String?)

/**
 * Operator reads/writes (AdminService). Every RPC requires the `admin` role, enforced by the server's
 * RoleInterceptor; the client-side role check only hides the UI.
 */
internal interface AdminRepository {
    suspend fun overview(): Outcome<AdminOverview>

    suspend fun tasks(query: String, pageToken: String? = null): Outcome<Page<AdminTaskRow>>

    /** [reason] is recorded in the audit log (3..500 characters). */
    suspend fun deleteTask(id: String, reason: String): Outcome<Unit>

    suspend fun auditLog(pageToken: String? = null): Outcome<Page<AuditRow>>
}
