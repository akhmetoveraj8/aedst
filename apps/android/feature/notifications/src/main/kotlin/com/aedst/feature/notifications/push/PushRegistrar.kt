package com.aedst.feature.notifications.push

import android.content.Context
import android.os.Build
import androidx.datastore.core.DataStore
import com.aedst.core.common.Logger
import com.aedst.core.datastore.UserPrefs
import com.aedst.core.network.rpc
import com.aedst.notifications.v1.NotificationsServiceClientInterface
import com.aedst.notifications.v1.PushPlatform
import com.aedst.notifications.v1.registerPushDeviceRequest
import com.aedst.notifications.v1.unregisterPushDeviceRequest
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.tasks.await
import java.util.Locale
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Keeps this install's FCM token registered with the server (`RegisterPushDevice(FCM)`) for the signed-in user:
 *  - on sign-in / app start while signed in ([sync] from [PushInitializer]);
 *  - when FCM rotates the token (`onNewToken` → [sync]);
 *  - unregistered before an explicit sign-out ([unregister] via `SignOutHook`, while the bearer token is valid).
 *
 * Re-registration is skipped when token and user are unchanged. Everything is best-effort: push is an enhancement,
 * a failure is logged and retried on the next trigger. No-op when Firebase is not configured
 * (no `google-services.json` at build time).
 */
@Singleton
class PushRegistrar @Inject constructor(
    @ApplicationContext private val context: Context,
    private val client: NotificationsServiceClientInterface,
    private val prefs: DataStore<UserPrefs>,
    private val logger: Logger,
) {
    private val mutex = Mutex()

    val isAvailable: Boolean get() = FirebaseApp.getApps(context).isNotEmpty()

    suspend fun sync(userId: String, token: String? = null) = bestEffort("register") {
        if (!isAvailable) return@bestEffort
        mutex.withLock {
            val fcmToken = token ?: FirebaseMessaging.getInstance().token.await()
            val current = prefs.data.first()
            val isUpToDate = current.pushDeviceId.isNotEmpty() &&
                current.pushRegisteredToken == fcmToken &&
                current.pushRegisteredUserId == userId
            if (isUpToDate) return@withLock

            val response = rpc {
                client.registerPushDevice(
                    registerPushDeviceRequest {
                        platform = PushPlatform.PUSH_PLATFORM_FCM
                        this.token = fcmToken
                        deviceName = "${Build.MANUFACTURER} ${Build.MODEL} · Android ${Build.VERSION.RELEASE}"
                            .take(MAX_DEVICE_NAME)
                        locale = Locale.getDefault().toLanguageTag().take(MAX_LOCALE)
                    },
                )
            }
            prefs.updateData {
                it.toBuilder()
                    .setPushDeviceId(response.deviceId)
                    .setPushRegisteredToken(fcmToken)
                    .setPushRegisteredUserId(userId)
                    .build()
            }
        }
    }

    suspend fun unregister() = bestEffort("unregister") {
        mutex.withLock {
            val deviceId = prefs.data.first().pushDeviceId
            try {
                if (deviceId.isNotEmpty()) {
                    rpc { client.unregisterPushDevice(unregisterPushDeviceRequest { this.deviceId = deviceId }) }
                }
                // Rotate the token so a later account on this device never receives the previous user's pushes.
                if (isAvailable) FirebaseMessaging.getInstance().deleteToken().await()
            } finally {
                prefs.updateData {
                    it.toBuilder().clearPushDeviceId().clearPushRegisteredToken().clearPushRegisteredUserId().build()
                }
            }
        }
    }

    private suspend fun bestEffort(operation: String, block: suspend () -> Unit) {
        try {
            block()
        } catch (cancellation: CancellationException) {
            throw cancellation
        } catch (@Suppress("TooGenericExceptionCaught") throwable: Throwable) {
            logger.warn(TAG, "Push $operation failed: ${throwable.javaClass.simpleName}")
        }
    }

    private companion object {
        const val TAG = "PushRegistrar"
        const val MAX_DEVICE_NAME = 120
        const val MAX_LOCALE = 35
    }
}
