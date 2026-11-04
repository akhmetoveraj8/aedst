package com.aedst.feature.notifications.push

import android.Manifest
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationChannelCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.aedst.core.navigation.AedstRoutes
import com.aedst.feature.notifications.R
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Notification channels (one per notification family, so users can mute e.g. "Media" without losing "Tasks") and
 * rendering of pushes received while the app is in the foreground or as data-only messages.
 *
 * FCM payload contract with the server (`data` keys): `kind` (NotificationKind name, e.g.
 * `NOTIFICATION_KIND_TASK_COMPLETED`), `title`, `body`, `link` (relative in-app route such as `/tasks/<id>`),
 * `notification_id`. Tapping opens the launcher activity with the [AedstRoutes.EXTRA_LINK] extra.
 */
@Singleton
class PushNotifier @Inject constructor(@ApplicationContext private val context: Context) {

    fun createChannels() {
        val manager = NotificationManagerCompat.from(context)
        listOf(
            Triple(CHANNEL_TASKS, R.string.notifications_channel_tasks, NotificationManagerCompat.IMPORTANCE_DEFAULT),
            Triple(CHANNEL_MEDIA, R.string.notifications_channel_media, NotificationManagerCompat.IMPORTANCE_LOW),
            Triple(
                context.getString(R.string.notifications_channel_system_id),
                R.string.notifications_channel_system,
                NotificationManagerCompat.IMPORTANCE_DEFAULT,
            ),
        ).forEach { (id, name, importance) ->
            manager.createNotificationChannel(
                NotificationChannelCompat.Builder(id, importance).setName(context.getString(name)).build(),
            )
        }
    }

    fun show(data: Map<String, String>, fallbackTitle: String?, fallbackBody: String?) {
        if (!canPost()) return
        val title = data[KEY_TITLE] ?: fallbackTitle ?: return
        val body = data[KEY_BODY] ?: fallbackBody.orEmpty()
        val notificationId = (data[KEY_NOTIFICATION_ID] ?: title + body).hashCode()

        val notification = NotificationCompat.Builder(context, channelFor(data[KEY_KIND]))
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setAutoCancel(true)
            .setContentIntent(contentIntent(AedstRoutes.routeForLink(data[KEY_LINK])?.let { data[KEY_LINK] }))
            .build()
        @Suppress("MissingPermission") // checked in canPost()
        NotificationManagerCompat.from(context).notify(notificationId, notification)
    }

    private fun canPost(): Boolean {
        val manager = NotificationManagerCompat.from(context)
        val hasRuntimePermission = Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED
        return manager.areNotificationsEnabled() && hasRuntimePermission
    }

    private fun channelFor(kind: String?): String = when {
        kind == null -> context.getString(R.string.notifications_channel_system_id)
        kind.contains("TASK", ignoreCase = true) -> CHANNEL_TASKS
        kind.contains("MEDIA", ignoreCase = true) -> CHANNEL_MEDIA
        else -> context.getString(R.string.notifications_channel_system_id)
    }

    private fun contentIntent(link: String?): PendingIntent? {
        val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return null
        launch.addFlags(
            Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP,
        )
        link?.let { launch.putExtra(AedstRoutes.EXTRA_LINK, it) }
        return PendingIntent.getActivity(
            context,
            link.hashCode(),
            launch,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    companion object {
        const val CHANNEL_TASKS = "tasks"
        const val CHANNEL_MEDIA = "media"
        const val KEY_KIND = "kind"
        const val KEY_TITLE = "title"
        const val KEY_BODY = "body"
        const val KEY_LINK = AedstRoutes.EXTRA_LINK
        const val KEY_NOTIFICATION_ID = "notification_id"
    }
}
