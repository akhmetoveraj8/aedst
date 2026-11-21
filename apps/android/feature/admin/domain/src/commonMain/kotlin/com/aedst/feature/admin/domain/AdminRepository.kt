package com.aedst.feature.admin.domain

import com.aedst.core.common.Outcome
import kotlin.time.Instant

public data class AdminOverview(
    val tasksTotal: Long,
    val tasksDone: Long,
    val tasksOverdue: Long,
    val mediaTotal: Long,
    val mediaBytes: Long,
    val pushDevices: Long,
    val outboxLagSeconds: Long,
    val jobsPending: Long,
)

public data class AdminTaskRow(val id: String, val ownerId: String, val title: String, val isDone: Boolean)

public data class AuditRow(
    val id: String,
    val actorId: String,
    val action: String,
    val target: String,
    val reason: String,
    val createdAt: Instant?,
)

public data class Page<T>(val items: List<T>, val nextPageToken: String?)

/**
 * Operator reads/writes (AdminService). Every RPC requires the `admin` role, enforced by the server's
 * RoleInterceptor; the client-side role check only hides the UI.
 */
public interface AdminRepository {
    public suspend fun overview(): Outcome<AdminOverview>

    public suspend fun tasks(query: String, pageToken: String? = null): Outcome<Page<AdminTaskRow>>

    /** [reason] is recorded in the audit log (3..500 characters). */
    public suspend fun deleteTask(id: String, reason: String): Outcome<Unit>

    public suspend fun auditLog(pageToken: String? = null): Outcome<Page<AuditRow>>
}
