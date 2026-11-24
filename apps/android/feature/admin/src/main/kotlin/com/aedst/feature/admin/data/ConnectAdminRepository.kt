package com.aedst.feature.admin.data

import com.aedst.admin.v1.AdminServiceClient
import com.aedst.admin.v1.AdminServiceClientInterface
import com.aedst.admin.v1.deleteTaskRequest
import com.aedst.admin.v1.getOverviewRequest
import com.aedst.admin.v1.listAuditLogRequest
import com.aedst.admin.v1.listTasksRequest
import com.aedst.core.common.Outcome
import com.aedst.core.common.runCatchingOutcome
import com.aedst.core.network.rpc
import com.aedst.core.network.toInstantOrNull
import com.aedst.feature.admin.domain.AdminOverview
import com.aedst.feature.admin.domain.AdminRepository
import com.aedst.feature.admin.domain.AdminTaskRow
import com.aedst.feature.admin.domain.AuditRow
import com.aedst.feature.admin.domain.Page
import com.connectrpc.ProtocolClientInterface
import dev.zacsweers.metro.AppScope
import dev.zacsweers.metro.BindingContainer
import dev.zacsweers.metro.ContributesBinding
import dev.zacsweers.metro.ContributesTo
import dev.zacsweers.metro.Inject
import dev.zacsweers.metro.Provides
import dev.zacsweers.metro.SingleIn

@ContributesBinding(AppScope::class)
@Inject
internal class ConnectAdminRepository(private val client: AdminServiceClientInterface) : AdminRepository {

    override suspend fun overview(): Outcome<AdminOverview> = runCatchingOutcome {
        val response = rpc { client.getOverview(getOverviewRequest { }) }
        AdminOverview(
            tasksTotal = response.tasksTotal,
            tasksDone = response.tasksDone,
            tasksOverdue = response.tasksOverdue,
            mediaTotal = response.mediaTotal,
            mediaBytes = response.mediaBytes,
            pushDevices = response.pushDevices,
            outboxLagSeconds = response.outboxLagSeconds,
            jobsPending = response.jobsPending,
        )
    }

    override suspend fun tasks(query: String, pageToken: String?): Outcome<Page<AdminTaskRow>> = runCatchingOutcome {
        val response = rpc {
            client.listTasks(
                listTasksRequest {
                    this.query = query.trim().take(MAX_QUERY)
                    pageSize = PAGE_SIZE
                    pageToken?.let { this.pageToken = it }
                },
            )
        }
        Page(
            // AdminTask.status is the aedst.tasks.v1.TaskStatus number; 3 = TASK_STATUS_DONE.
            items = response.tasksList.map { AdminTaskRow(it.id, it.ownerId, it.title, it.status == STATUS_DONE) },
            nextPageToken = response.nextPageToken.takeIf(String::isNotEmpty),
        )
    }

    override suspend fun deleteTask(id: String, reason: String): Outcome<Unit> = runCatchingOutcome {
        rpc {
            client.deleteTask(
                deleteTaskRequest {
                    this.id = id
                    this.reason = reason.trim()
                },
            )
        }
        Unit
    }

    override suspend fun auditLog(pageToken: String?): Outcome<Page<AuditRow>> = runCatchingOutcome {
        val response = rpc {
            client.listAuditLog(
                listAuditLogRequest {
                    pageSize = PAGE_SIZE
                    pageToken?.let { this.pageToken = it }
                },
            )
        }
        Page(
            items = response.entriesList.map {
                AuditRow(
                    id = it.id,
                    actorId = it.actorId,
                    action = it.action,
                    target = "${it.targetKind}:${it.targetId}",
                    reason = it.reason,
                    createdAt = if (it.hasCreatedAt()) it.createdAt.toInstantOrNull() else null,
                )
            },
            nextPageToken = response.nextPageToken.takeIf(String::isNotEmpty),
        )
    }

    private companion object {
        const val PAGE_SIZE = 50
        const val MAX_QUERY = 200
        const val STATUS_DONE = 3
    }
}

@BindingContainer
@ContributesTo(AppScope::class)
object AdminProviders {
    @Provides
    @SingleIn(AppScope::class)
    fun provideAdminServiceClient(client: ProtocolClientInterface): AdminServiceClientInterface =
        AdminServiceClient(client)
}
