package com.aedst.core.navigation

import kotlinx.serialization.json.Json
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Test

class AedstKeyTest {

    private val allKeys: List<AedstKey> = listOf(
        LoginKey,
        AccountKey,
        TaskListKey,
        TaskDetailKey("t-1"),
        TaskCreateKey,
        SearchKey,
        NotificationsKey,
        NotificationPreferencesKey,
        MediaLibraryKey,
        MediaDetailKey("m-1"),
        AdminKey,
    )

    @Test
    fun `every key survives a serialization round trip`() {
        allKeys.forEach { key ->
            val json = Json.encodeToString(AedstKey.serializer(), key)
            assertEquals(key, Json.decodeFromString(AedstKey.serializer(), json))
        }
    }

    @Test
    fun `screen names are templates and never contain ids`() {
        assertEquals("tasks/{taskId}", TaskDetailKey("secret-id").screenName)
        assertEquals("media/{mediaId}", MediaDetailKey("secret-id").screenName)
        allKeys.forEach { key -> assertFalse(key.screenName.contains("-1")) }
    }

    @Test
    fun `every tab root is a distinct key`() {
        assertEquals(AedstTab.entries.size, AedstTab.entries.map { it.root }.toSet().size)
        assertEquals(AedstTab.NOTIFICATIONS, AedstTab.forRoot(NotificationsKey))
    }
}
