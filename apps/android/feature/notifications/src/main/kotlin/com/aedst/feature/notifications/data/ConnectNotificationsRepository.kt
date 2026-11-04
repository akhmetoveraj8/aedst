package com.aedst.feature.notifications.data

import com.aedst.core.common.Outcome
import com.aedst.core.common.runCatchingOutcome
import com.aedst.core.network.rpc
import com.aedst.core.network.toInstantOrNull
import com.aedst.feature.notifications.domain.InboxNotification
import com.aedst.feature.notifications.domain.InboxPage
import com.aedst.feature.notifications.domain.NotificationKind
import com.aedst.feature.notifications.domain.NotificationPreferences
import com.aedst.feature.notifications.domain.NotificationsRepository
import com.aedst.notifications.v1.Notification
import com.aedst.notifications.v1.NotificationsServiceClientInterface
import com.aedst.notifications.v1.Preferences
import com.aedst.notifications.v1.getPreferencesRequest
import com.aedst.notifications.v1.getUnreadCountRequest
import com.aedst.notifications.v1.listNotificationsRequest
import com.aedst.notifications.v1.markAllReadRequest
import com.aedst.notifications.v1.markReadRequest
import com.aedst.notifications.v1.updatePreferencesRequest
import javax.inject.Inject
import com.aedst.notifications.v1.NotificationKind as ProtoNotificationKind

internal class ConnectNotificationsRepository @Inject constructor(
    private val client: NotificationsServiceClientInterface,
    private val unreadStore: UnreadCountStore,
) : NotificationsRepository {

    override suspend fun list(unreadOnly: Boolean, pageToken: String?): Outcome<InboxPage> = runCatchingOutcome {
        val response = rpc {
            client.listNotifications(
                listNotificationsRequest {
                    this.unreadOnly = unreadOnly
                    pageSize = PAGE_SIZE
                    pageToken?.let { this.pageToken = it }
                },
            )
        }
        InboxPage(
            notifications = response.notificationsList.map { it.toDomain() },
            nextPageToken = response.nextPageToken.takeIf(String::isNotEmpty),
        )
    }

    override suspend fun unreadCount(): Outcome<Int> = runCatchingOutcome {
        rpc { client.getUnreadCount(getUnreadCountRequest { }) }.unread.also(unreadStore::set)
    }

    override suspend fun markRead(ids: List<String>): Outcome<Unit> = runCatchingOutcome {
        // MarkReadRequest.ids is validated to 1..100 items.
        for (chunk in ids.chunked(MAX_MARK_READ_IDS)) {
            rpc { client.markRead(markReadRequest { this.ids += chunk }) }
        }
        unreadStore.decrementBy(ids.size)
    }

    override suspend fun markAllRead(): Outcome<Int> = runCatchingOutcome {
        rpc { client.markAllRead(markAllReadRequest { }) }.marked.also { unreadStore.set(0) }
    }

    override suspend fun preferences(): Outcome<NotificationPreferences> = runCatchingOutcome {
        rpc { client.getPreferences(getPreferencesRequest { }) }.preferences.toDomain()
    }

    override suspend fun updatePreferences(preferences: NotificationPreferences): Outcome<NotificationPreferences> =
        runCatchingOutcome {
            rpc {
                client.updatePreferences(
                    updatePreferencesRequest {
                        this.preferences = Preferences.newBuilder()
                            .setPushEnabled(preferences.pushEnabled)
                            .setTaskCompleted(preferences.taskCompleted)
                            .setTaskDueSoon(preferences.taskDueSoon)
                            .setMediaReady(preferences.mediaReady)
                            .build()
                    },
                )
            }.preferences.toDomain()
        }

    private companion object {
        const val PAGE_SIZE = 30
        const val MAX_MARK_READ_IDS = 100
    }
}

private fun Notification.toDomain() = InboxNotification(
    id = id,
    kind = when (kind) {
        ProtoNotificationKind.NOTIFICATION_KIND_TASK_COMPLETED -> NotificationKind.TASK_COMPLETED
        ProtoNotificationKind.NOTIFICATION_KIND_TASK_DUE_SOON -> NotificationKind.TASK_DUE_SOON
        ProtoNotificationKind.NOTIFICATION_KIND_MEDIA_READY -> NotificationKind.MEDIA_READY
        // A kind this build does not know is still a displayable message: use the generic one, not a task kind.
        ProtoNotificationKind.NOTIFICATION_KIND_SYSTEM,
        ProtoNotificationKind.NOTIFICATION_KIND_UNSPECIFIED,
        ProtoNotificationKind.UNRECOGNIZED,
        -> NotificationKind.SYSTEM
    },
    title = title,
    body = body,
    link = link.takeIf(String::isNotEmpty),
    createdAt = if (hasCreatedAt()) createdAt.toInstantOrNull() else null,
    readAt = if (hasReadAt()) readAt.toInstantOrNull() else null,
)

private fun Preferences.toDomain() = NotificationPreferences(
    pushEnabled = pushEnabled,
    taskCompleted = taskCompleted,
    taskDueSoon = taskDueSoon,
    mediaReady = mediaReady,
)
