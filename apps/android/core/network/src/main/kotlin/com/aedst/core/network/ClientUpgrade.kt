package com.aedst.core.network

import com.aedst.core.common.ClientUpgradeState
import com.connectrpc.Code
import com.connectrpc.ConnectException
import com.connectrpc.Interceptor
import com.connectrpc.StreamFunction
import com.connectrpc.UnaryFunction
import com.google.protobuf.CodedInputStream
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.io.IOException
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Forced-upgrade protocol (ADR-0009). The server answers a build older than `AEDST_MIN_CLIENT_VERSIONS` with Connect
 * `failed_precondition` carrying a `google.rpc.ErrorInfo` detail whose reason is [REASON]
 * (`apps/server/internal/platform/httpserver/clientversion.go`). The generated client has no `google.rpc` classes, so
 * the one field we need (`ErrorInfo.reason`, field 1) is read with protobuf's own [CodedInputStream].
 */
internal object ClientUpgrade {
    const val REASON = "CLIENT_UPGRADE_REQUIRED"
    private const val ERROR_INFO_TYPE = "google.rpc.ErrorInfo"
    private const val REASON_TAG = 10 // field 1, wire type 2 (length-delimited)

    /** The `reason` of a serialized `google.rpc.ErrorInfo`, or null when it is not parseable. */
    fun reasonOf(errorInfo: ByteArray): String? = try {
        val input = CodedInputStream.newInstance(errorInfo)
        var reason: String? = null
        while (reason == null) {
            val tag = input.readTag()
            if (tag == 0) break
            if (tag == REASON_TAG) reason = input.readStringRequireUtf8() else input.skipField(tag)
        }
        reason
    } catch (@Suppress("SwallowedException") e: IOException) {
        null
    }

    /** True for a [ConnectException] decoded by connect-kotlin that carries the upgrade-required ErrorInfo. */
    fun isUpgradeRequired(error: ConnectException): Boolean = error.code == Code.FAILED_PRECONDITION &&
        error.details.any { detail ->
            detail.type.endsWith(ERROR_INFO_TYPE) && reasonOf(detail.payload.toByteArray()) == REASON
        }
}

/** Process-wide holder of the latched "upgrade required" signal; written by [ClientUpgradeInterceptor]. */
@Singleton
class ClientUpgradeGate @Inject constructor() : ClientUpgradeState {
    private val required = MutableStateFlow(false)
    override val upgradeRequired: StateFlow<Boolean> = required.asStateFlow()

    fun report() {
        required.value = true
    }
}

/**
 * Watches every unary response of the ConnectRPC client (view models, workers and the outbox alike) for the
 * upgrade-required error and flips [ClientUpgradeGate]. The response is passed on untouched, so the caller still gets
 * the mapped `AedstError.UpgradeRequired` from [toAedstError].
 */
class ClientUpgradeInterceptor @Inject constructor(private val gate: ClientUpgradeGate) : Interceptor {
    override fun unaryFunction(): UnaryFunction = UnaryFunction(
        responseFunction = { response ->
            if (response.cause?.let(ClientUpgrade::isUpgradeRequired) == true) gate.report()
            response
        },
    )

    override fun streamFunction(): StreamFunction = StreamFunction()
}

@Module
@InstallIn(SingletonComponent::class)
abstract class ClientUpgradeModule {
    @Binds
    abstract fun bindClientUpgradeState(impl: ClientUpgradeGate): ClientUpgradeState
}
