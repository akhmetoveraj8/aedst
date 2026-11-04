package com.aedst.core.navigation

import androidx.navigation3.runtime.NavKey
import kotlinx.serialization.Serializable

/**
 * Every destination of the app as a typed Navigation 3 key. The back stack is a plain list of these keys owned by
 * the app (`AedstTabNavigator` / `AedstStackNavigator`), saved across process death by `rememberNavBackStack`, so
 * keys must stay small and `@Serializable` (kotlinx.serialization is used for navigation keys and local JSON only —
 * API payloads are protobuf).
 *
 * Keys live in `core/navigation` so a feature can navigate to another feature's screen (tasks → media) without a
 * Gradle dependency on it; the owning feature registers the entry for the key.
 */
@Serializable
sealed interface AedstKey : NavKey {
    /**
     * Name reported to analytics and crash breadcrumbs: the route *template* (`tasks/{taskId}`), never a concrete id.
     * A getter without a backing field, so it is not part of the serialized form.
     */
    val screenName: String
}

@Serializable
data object LoginKey : AedstKey {
    override val screenName: String get() = "auth/login"
}

@Serializable
data object AccountKey : AedstKey {
    override val screenName: String get() = "auth/account"
}

@Serializable
data object TaskListKey : AedstKey {
    override val screenName: String get() = "tasks"
}

@Serializable
data class TaskDetailKey(val taskId: String) : AedstKey {
    override val screenName: String get() = "tasks/{taskId}"
}

@Serializable
data object TaskCreateKey : AedstKey {
    override val screenName: String get() = "task-create"
}

@Serializable
data object SearchKey : AedstKey {
    override val screenName: String get() = "search"
}

@Serializable
data object NotificationsKey : AedstKey {
    override val screenName: String get() = "notifications"
}

@Serializable
data object NotificationPreferencesKey : AedstKey {
    override val screenName: String get() = "notification-preferences"
}

@Serializable
data object MediaLibraryKey : AedstKey {
    override val screenName: String get() = "media"
}

@Serializable
data class MediaDetailKey(val mediaId: String) : AedstKey {
    override val screenName: String get() = "media/{mediaId}"
}

/** Only shown to users with the `admin` role (see `SessionUser.isAdmin`); the server authorises every admin RPC. */
@Serializable
data object AdminKey : AedstKey {
    override val screenName: String get() = "admin"
}
