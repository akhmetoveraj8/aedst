package com.aedst.feature.notifications.push

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.aedst.core.common.Logger
import com.aedst.core.datastore.createUserPrefsDataStore
import com.aedst.notifications.v1.NotificationsServiceClient
import com.aedst.notifications.v1.PushPlatform
import com.aedst.notifications.v1.RegisterPushDeviceRequest
import com.aedst.notifications.v1.registerPushDeviceResponse
import com.connectrpc.ProtocolClientConfig
import com.connectrpc.extensions.GoogleJavaLiteProtobufStrategy
import com.connectrpc.impl.ProtocolClient
import com.connectrpc.okhttp.ConnectOkHttpClient
import com.connectrpc.protocols.NetworkProtocol
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okio.Buffer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/**
 * FCM registration path on a device runtime: a real [FirebaseApp] (dummy options, so [PushRegistrar.isAvailable] is
 * true without a `google-services.json`), the explicit-token branch of `sync` (no call to Google), the real generated
 * client against a [MockWebServer] and a real UserPrefs DataStore. Covers the request the server receives, the stored
 * device id, the "unchanged token is not re-sent" rule and re-registration after FCM rotates the token.
 *
 * Not covered here (needs a device with Play services and a real `google-services.json`): obtaining a token from FCM
 * and receiving a message. See docs/content/android/device-verification.md.
 */
@RunWith(AndroidJUnit4::class)
class PushRegistrarInstrumentedTest {

    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private lateinit var server: MockWebServer
    private lateinit var registrar: PushRegistrar
    private val prefsFile = File(context.cacheDir, "push-registrar-test-${System.nanoTime()}.pb")
    private val prefs = createUserPrefsDataStore { prefsFile }

    @Before
    fun setUp() {
        if (FirebaseApp.getApps(context).isEmpty()) {
            FirebaseApp.initializeApp(
                context,
                FirebaseOptions.Builder()
                    .setApplicationId("1:1234567890:android:0000000000000000")
                    .setApiKey("test-api-key")
                    .setProjectId("aedst-instrumented-test")
                    .build(),
            )
        }
        server = MockWebServer().apply { start() }
        val client = NotificationsServiceClient(
            ProtocolClient(
                httpClient = ConnectOkHttpClient(OkHttpClient()),
                ProtocolClientConfig(
                    host = server.url("/").toString().trimEnd('/'),
                    serializationStrategy = GoogleJavaLiteProtobufStrategy(),
                    networkProtocol = NetworkProtocol.CONNECT,
                ),
            ),
        )
        registrar = PushRegistrar(
            context,
            client,
            prefs,
            object : Logger {
                override fun debug(tag: String, message: String) = Unit

                override fun warn(tag: String, message: String, throwable: Throwable?) = Unit

                override fun error(tag: String, message: String, throwable: Throwable?) = Unit
            },
        )
    }

    @After
    fun tearDown() {
        server.shutdown()
        prefsFile.delete()
    }

    private fun enqueueRegistered(deviceId: String) {
        server.enqueue(
            MockResponse().setResponseCode(200).setHeader("Content-Type", "application/proto")
                .setBody(Buffer().write(registerPushDeviceResponse { this.deviceId = deviceId }.toByteArray())),
        )
    }

    @Test
    fun registersTheFcmTokenAndRemembersTheDevice() = runBlocking {
        assertTrue(registrar.isAvailable)
        enqueueRegistered("dev-1")

        registrar.sync("user-1", token = "fcm-token-1")

        val request = server.takeRequest()
        assertEquals("/aedst.notifications.v1.NotificationsService/RegisterPushDevice", request.path)
        val body = RegisterPushDeviceRequest.parseFrom(request.body.readByteArray())
        assertEquals(PushPlatform.PUSH_PLATFORM_FCM, body.platform)
        assertEquals("fcm-token-1", body.token)
        val stored = prefs.data.first()
        assertEquals("dev-1", stored.pushDeviceId)
        assertEquals("fcm-token-1", stored.pushRegisteredToken)
        assertEquals("user-1", stored.pushRegisteredUserId)
    }

    @Test
    fun anUnchangedTokenForTheSameUserIsNotSentAgain() = runBlocking {
        enqueueRegistered("dev-1")
        registrar.sync("user-1", token = "t")
        registrar.sync("user-1", token = "t")

        assertEquals(1, server.requestCount)
    }

    @Test
    fun aRotatedTokenOrANewUserIsRegisteredAgain() = runBlocking {
        enqueueRegistered("dev-1")
        enqueueRegistered("dev-2")
        enqueueRegistered("dev-3")

        registrar.sync("user-1", token = "t1")
        registrar.sync("user-1", token = "t2") // onNewToken
        registrar.sync("user-2", token = "t2") // account switch

        assertEquals(3, server.requestCount)
        assertEquals("dev-3", prefs.data.first().pushDeviceId)
    }

    @Test
    fun aServerFailureIsSwallowedAndLeavesNothingRemembered() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(503))

        registrar.sync("user-1", token = "t")

        assertEquals("", prefs.data.first().pushDeviceId)
    }
}
