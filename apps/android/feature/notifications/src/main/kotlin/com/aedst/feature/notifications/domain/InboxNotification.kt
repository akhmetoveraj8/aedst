package com.aedst.feature.notifications.domain

import com.aedst.core.common.Outcome
import java.time.Instant

enum class NotificationKind { TASK_COMPLETED, TASK_DUE_SOON, MEDIA_READY, SYSTEM }

data class InboxNotification(
    val id: String,
    val kind: NotificationKind,
    val title: String,
    val body: String,
    /** Relative in-app link (`/tasks/<id>`), resolved with `AedstRoutes.routeForLink`. */
    val link: String?,
    val createdAt: Instant?,
    val readAt: Instant?,
) {
    val isUnread: Boolean get() = readAt == null
}

data class InboxPage(val notifications: List<InboxNotification>, val nextPageToken: String?)

data class NotificationPreferences(
    val pushEnabled: Boolean,
    val taskCompleted: Boolean,
    val taskDueSoon: Boolean,
    val mediaReady: Boolean,
)

/** The caller's inbox and preferences (NotificationsService). */
internal interface NotificationsRepository {
    suspend fun list(unreadOnly: Boolean = false, pageToken: String? = null): Outcome<InboxPage>

    suspend fun unreadCount(): Outcome<Int>

    suspend fun markRead(ids: List<String>): Outcome<Unit>

    suspend fun markAllRead(): Outcome<Int>

    suspend fun preferences(): Outcome<NotificationPreferences>

    suspend fun updatePreferences(preferences: NotificationPreferences): Outcome<NotificationPreferences>
}
