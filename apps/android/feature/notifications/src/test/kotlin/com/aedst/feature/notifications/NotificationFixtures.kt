package com.aedst.feature.notifications

import com.aedst.core.common.AedstError
import com.aedst.core.common.Outcome
import com.aedst.feature.notifications.domain.InboxNotification
import com.aedst.feature.notifications.domain.InboxPage
import com.aedst.feature.notifications.domain.NotificationKind
import com.aedst.feature.notifications.domain.NotificationPreferences
import com.aedst.feature.notifications.domain.NotificationsRepository
import java.time.Instant

internal fun inboxNotification(id: String, readAt: Instant? = null) = InboxNotification(
    id = id,
    kind = NotificationKind.SYSTEM,
    title = "Title $id",
    body = "Body $id",
    link = null,
    createdAt = Instant.parse("2026-01-01T00:00:00Z"),
    readAt = readAt,
)

internal val allEnabled = NotificationPreferences(
    pushEnabled = true,
    taskCompleted = true,
    taskDueSoon = true,
    mediaReady = true,
)

/** [NotificationsRepository] whose answers are set by the test; records the calls the ViewModels make. */
internal class ScriptedNotificationsRepository : NotificationsRepository {
    var pages: Map<String?, InboxPage> = emptyMap()
    var listFailure: AedstError? = null
    var markReadFailure: AedstError? = null
    var markAllReadFailure: AedstError? = null
    var preferencesResult: Outcome<NotificationPreferences> = Outcome.Success(allEnabled)
    var updateResult: ((NotificationPreferences) -> Outcome<NotificationPreferences>) = { Outcome.Success(it) }

    val listCalls = mutableListOf<String?>()
    val markedRead = mutableListOf<List<String>>()
    var markAllReadCalls = 0
    var unreadCountCalls = 0
    val updates = mutableListOf<NotificationPreferences>()

    override suspend fun list(unreadOnly: Boolean, pageToken: String?): Outcome<InboxPage> {
        listCalls += pageToken
        return listFailure?.let { Outcome.Failure(it) } ?: Outcome.Success(pages.getValue(pageToken))
    }

    override suspend fun unreadCount(): Outcome<Int> {
        unreadCountCalls++
        return Outcome.Success(0)
    }

    override suspend fun markRead(ids: List<String>): Outcome<Unit> {
        markedRead += ids
        return markReadFailure?.let { Outcome.Failure(it) } ?: Outcome.Success(Unit)
    }

    override suspend fun markAllRead(): Outcome<Int> {
        markAllReadCalls++
        return markAllReadFailure?.let { Outcome.Failure(it) } ?: Outcome.Success(0)
    }

    override suspend fun preferences(): Outcome<NotificationPreferences> = preferencesResult

    override suspend fun updatePreferences(preferences: NotificationPreferences): Outcome<NotificationPreferences> {
        updates += preferences
        return updateResult(preferences)
    }
}
