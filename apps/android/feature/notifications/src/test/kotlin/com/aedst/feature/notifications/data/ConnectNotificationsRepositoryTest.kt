package com.aedst.feature.notifications.data

import com.aedst.core.common.AedstError
import com.aedst.core.common.Outcome
import com.aedst.core.network.toTimestamp
import com.aedst.feature.notifications.domain.NotificationKind
import com.aedst.notifications.v1.NotificationsServiceClientInterface
import com.aedst.notifications.v1.getPreferencesResponse
import com.aedst.notifications.v1.getUnreadCountResponse
import com.aedst.notifications.v1.listNotificationsResponse
import com.aedst.notifications.v1.markAllReadResponse
import com.aedst.notifications.v1.markReadResponse
import com.aedst.notifications.v1.notification
import com.aedst.notifications.v1.preferences
import com.connectrpc.Code
import com.connectrpc.ConnectException
import com.connectrpc.ResponseMessage
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.time.Instant
import com.aedst.notifications.v1.NotificationKind as ProtoNotificationKind

class ConnectNotificationsRepositoryTest {

    private val client = mockk<NotificationsServiceClientInterface>()
    private val unread = UnreadCountStore()
    private val repository = ConnectNotificationsRepository(client, unread)

    private fun <T> success(message: T) = ResponseMessage.Success(message, emptyMap(), emptyMap())

    @Test
    fun `known kinds keep their meaning`() = runTest {
        coEvery { client.listNotifications(any(), any()) } returns success(
            listNotificationsResponse {
                notifications += notification {
                    id = "1"
                    kind = ProtoNotificationKind.NOTIFICATION_KIND_TASK_COMPLETED
                }
                notifications += notification {
                    id = "2"
                    kind = ProtoNotificationKind.NOTIFICATION_KIND_TASK_DUE_SOON
                }
                notifications += notification {
                    id = "3"
                    kind = ProtoNotificationKind.NOTIFICATION_KIND_MEDIA_READY
                }
                notifications += notification {
                    id = "4"
                    kind = ProtoNotificationKind.NOTIFICATION_KIND_SYSTEM
                }
            },
        )

        val page = (repository.list() as Outcome.Success).value

        assertEquals(
            listOf(
                NotificationKind.TASK_COMPLETED,
                NotificationKind.TASK_DUE_SOON,
                NotificationKind.MEDIA_READY,
                NotificationKind.SYSTEM,
            ),
            page.notifications.map { it.kind },
        )
    }

    @Test
    fun `an unset or newer kind is shown as a generic system message, never as a task event`() = runTest {
        coEvery { client.listNotifications(any(), any()) } returns success(
            listNotificationsResponse {
                notifications += notification {
                    id = "1"
                    kind = ProtoNotificationKind.NOTIFICATION_KIND_UNSPECIFIED
                }
                notifications += notification {
                    id = "2"
                    kindValue = UNKNOWN_ENUM_VALUE
                }
            },
        )

        val page = (repository.list() as Outcome.Success).value

        assertEquals(listOf(NotificationKind.SYSTEM, NotificationKind.SYSTEM), page.notifications.map { it.kind })
    }

    @Test
    fun `fields, read state, link and cursor are mapped`() = runTest {
        val created = Instant.parse("2026-02-03T04:05:06Z")
        coEvery { client.listNotifications(any(), any()) } returns success(
            listNotificationsResponse {
                notifications += notification {
                    id = "1"
                    title = "Done"
                    body = "Task finished"
                    link = "/tasks/42"
                    createdAt = created.toTimestamp()
                }
                notifications += notification {
                    id = "2"
                    readAt = created.toTimestamp()
                }
                nextPageToken = "next"
            },
        )

        val page = (repository.list() as Outcome.Success).value

        val first = page.notifications[0]
        assertEquals("Done", first.title)
        assertEquals("/tasks/42", first.link)
        assertEquals(created, first.createdAt)
        assertTrue(first.isUnread)
        assertNull(page.notifications[1].link)
        assertFalse(page.notifications[1].isUnread)
        assertEquals("next", page.nextPageToken)
    }

    @Test
    fun `reading the unread count feeds the shared badge`() = runTest {
        coEvery { client.getUnreadCount(any(), any()) } returns success(getUnreadCountResponse { unread = 5 })

        val outcome = repository.unreadCount()

        assertEquals(5, (outcome as Outcome.Success).value)
        assertEquals(5, unread.count.value)
    }

    @Test
    fun `marking read sends chunks of at most 100 ids and lowers the badge once`() = runTest {
        unread.set(150)
        coEvery { client.markRead(any(), any()) } returns success(markReadResponse { })

        val ids = List(120) { "id-$it" }
        val outcome = repository.markRead(ids)

        assertTrue(outcome is Outcome.Success)
        coVerify(exactly = 2) { client.markRead(any(), any()) }
        assertEquals(30, unread.count.value)
    }

    @Test
    fun `marking everything read clears the badge`() = runTest {
        unread.set(9)
        coEvery { client.markAllRead(any(), any()) } returns success(markAllReadResponse { marked = 9 })

        val outcome = repository.markAllRead()

        assertEquals(9, (outcome as Outcome.Success).value)
        assertEquals(0, unread.count.value)
    }

    @Test
    fun `preferences are mapped field by field`() = runTest {
        coEvery { client.getPreferences(any(), any()) } returns success(
            getPreferencesResponse {
                preferences = preferences {
                    pushEnabled = true
                    taskCompleted = false
                    taskDueSoon = true
                    mediaReady = false
                }
            },
        )

        val prefs = (repository.preferences() as Outcome.Success).value

        assertTrue(prefs.pushEnabled)
        assertFalse(prefs.taskCompleted)
        assertTrue(prefs.taskDueSoon)
        assertFalse(prefs.mediaReady)
    }

    @Test
    fun `a server error leaves the badge alone and becomes a typed failure`() = runTest {
        unread.set(3)
        coEvery { client.markAllRead(any(), any()) } returns
            ResponseMessage.Failure(ConnectException(Code.UNAUTHENTICATED), emptyMap(), emptyMap())

        val outcome = repository.markAllRead()

        assertTrue((outcome as Outcome.Failure).error is AedstError.Unauthenticated)
        assertEquals(3, unread.count.value)
    }

    private companion object {
        /** A wire value no enum constant of this build has (a newer server). */
        const val UNKNOWN_ENUM_VALUE = 99
    }
}
