package com.aedst.feature.notifications.domain

import com.aedst.core.common.Outcome
import kotlin.time.Instant

public enum class NotificationKind { TASK_COMPLETED, TASK_DUE_SOON, MEDIA_READY, SYSTEM }

public data class InboxNotification(
    val id: String,
    val kind: NotificationKind,
    val title: String,
    val body: String,
    /** Relative in-app link (`/tasks/<id>`), resolved with `AedstRoutes.routeForLink`. */
    val link: String?,
    val createdAt: Instant?,
    val readAt: Instant?,
) {
    public val isUnread: Boolean get() = readAt == null
}

public data class InboxPage(val notifications: List<InboxNotification>, val nextPageToken: String?)

public data class NotificationPreferences(
    val pushEnabled: Boolean,
    val taskCompleted: Boolean,
    val taskDueSoon: Boolean,
    val mediaReady: Boolean,
)

/** The caller's inbox and preferences (NotificationsService). */
public interface NotificationsRepository {
    public suspend fun list(unreadOnly: Boolean = false, pageToken: String? = null): Outcome<InboxPage>

    public suspend fun unreadCount(): Outcome<Int>

    public suspend fun markRead(ids: List<String>): Outcome<Unit>

    public suspend fun markAllRead(): Outcome<Int>

    public suspend fun preferences(): Outcome<NotificationPreferences>

    public suspend fun updatePreferences(preferences: NotificationPreferences): Outcome<NotificationPreferences>
}
