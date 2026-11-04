package com.aedst.core.network

import com.aedst.core.common.AedstError
import com.connectrpc.Code
import com.connectrpc.ConnectException
import com.connectrpc.ResponseMessage
import com.connectrpc.getOrThrow
import kotlinx.coroutines.CancellationException
import java.io.IOException
import java.net.SocketTimeoutException
import java.net.UnknownHostException

/**
 * Maps a ConnectRPC/transport failure to the app-wide [AedstError] taxonomy (mirrors platform error mapping on the
 * server, and Apple's `NetworkErrorMapping`). The resulting `message` is diagnostic only — UI localizes by type
 * (`core/ui`'s `AedstError.userMessage()`), and shows it in a snackbar via `AedstErrorSnackbarEffect`.
 *
 * The table is shared with every client (docs/contract/behavior/error-kinds.json):
 *
 * | Connect code | AedstError |
 * |---|---|
 * | UNAUTHENTICATED | Unauthenticated |
 * | PERMISSION_DENIED | Forbidden |
 * | NOT_FOUND | NotFound |
 * | FAILED_PRECONDITION + ErrorInfo reason CLIENT_UPGRADE_REQUIRED | UpgradeRequired |
 * | INVALID_ARGUMENT, FAILED_PRECONDITION (otherwise), OUT_OF_RANGE | InvalidInput |
 * | ABORTED, ALREADY_EXISTS | Conflict |
 * | RESOURCE_EXHAUSTED | RateLimited |
 * | DEADLINE_EXCEEDED | Timeout |
 * | CANCELED | Cancelled |
 * | UNAVAILABLE | Unavailable (or Offline when the cause is an unknown host) |
 * | UNKNOWN, INTERNAL, UNIMPLEMENTED, DATA_LOSS | Unknown |
 */
// The Connect-code table above, one branch per documented code.
@Suppress("CyclomaticComplexMethod")
fun Throwable.toAedstError(): AedstError = when (this) {
    is AedstError -> this
    is ConnectException -> when (code) {
        Code.UNAUTHENTICATED -> AedstError.Unauthenticated()
        Code.PERMISSION_DENIED -> AedstError.Forbidden()
        Code.NOT_FOUND -> AedstError.NotFound()
        // ADR-0009: a too-old build gets FAILED_PRECONDITION + ErrorInfo CLIENT_UPGRADE_REQUIRED, not a form error.
        Code.FAILED_PRECONDITION ->
            if (ClientUpgrade.isUpgradeRequired(this)) {
                AedstError.UpgradeRequired()
            } else {
                AedstError.InvalidInput(message ?: "Invalid request")
            }
        Code.INVALID_ARGUMENT, Code.OUT_OF_RANGE -> AedstError.InvalidInput(message ?: "Invalid request")
        Code.ABORTED, Code.ALREADY_EXISTS -> AedstError.Conflict(message ?: "Conflict")
        Code.RESOURCE_EXHAUSTED -> AedstError.RateLimited(message ?: "Rate limited")
        Code.DEADLINE_EXCEEDED -> AedstError.Timeout(message ?: "Timed out", this)
        Code.CANCELED -> AedstError.Cancelled(message ?: "Cancelled", this)
        Code.UNKNOWN, Code.INTERNAL_ERROR, Code.UNIMPLEMENTED, Code.DATA_LOSS ->
            AedstError.Unknown(message ?: "Server error", this)
        // UNAVAILABLE, and the client-side codes connect-kotlin raises for transport failures.
        else -> (cause as? IOException)?.toAedstError() ?: AedstError.Unavailable(message ?: "Network error", this)
    }
    is UnknownHostException -> AedstError.Offline(message ?: "Unknown host", this)
    is SocketTimeoutException -> AedstError.Timeout(message ?: "Timed out", this)
    is IOException -> AedstError.Unavailable(message ?: "I/O error", this)
    else -> AedstError.Unavailable(message ?: "Network error", this)
}

/**
 * Runs one unary RPC and unwraps it: returns the message or throws the mapped [AedstError]. Use inside a
 * repository; `runCatchingOutcome`/`UseCase` turn the throw into an `Outcome.Failure`.
 *
 * ```
 * val task = rpc { client.getTask(getTaskRequest { id = taskId }) }.task
 * ```
 */
suspend fun <T> rpc(call: suspend () -> ResponseMessage<T>): T = try {
    call().getOrThrow()
} catch (cancellation: CancellationException) {
    throw cancellation
} catch (@Suppress("TooGenericExceptionCaught") throwable: Throwable) {
    throw throwable.toAedstError()
}
