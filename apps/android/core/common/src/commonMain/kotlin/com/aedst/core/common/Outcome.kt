package com.aedst.core.common

import kotlin.coroutines.cancellation.CancellationException

/**
 * Result wrapper every layer above `data/repository` returns instead of
 * throwing — mirrors `internal/shared` error handling on the server side.
 *
 * The case names are the shared error kinds of docs/contract/behavior/error-kinds.json (replayed by
 * `ErrorKindsReplayTest`); [kind] gives the canonical lower-camel name. [AedstError.message] is a diagnostic string for logs and crash reports; it
 * is never shown to users. UI maps the error *type* to a localized string
 * (see `core/ui`'s `AedstError.userMessage()`).
 */
public sealed interface Outcome<out T> {
    public data class Success<T>(val value: T) : Outcome<T>
    public data class Failure(val error: AedstError) : Outcome<Nothing>
}

public sealed class AedstError(override val message: String, override val cause: Throwable? = null) :
    Throwable(message, cause) {
    /** The server was reached (or should have been) but the call failed: 5xx, connection reset (kind `unavailable`). */
    public class Unavailable(message: String, cause: Throwable? = null) : AedstError(message, cause)

    /** The call ran out of time (Connect `DEADLINE_EXCEEDED`, socket timeout). */
    public class Timeout(message: String = "Timed out", cause: Throwable? = null) : AedstError(message, cause)

    /** The caller gave up (Connect `CANCELED`). Never shown to users; coroutine cancellation is rethrown instead. */
    public class Cancelled(message: String = "Cancelled", cause: Throwable? = null) : AedstError(message, cause)

    /** A local database or file failure. */
    public class Storage(message: String, cause: Throwable? = null) : AedstError(message, cause)

    /** The device has no usable connection; the operation may be queued and retried when it returns. */
    public class Offline(message: String = "Offline", cause: Throwable? = null) : AedstError(message, cause)

    /** No valid session (Connect `UNAUTHENTICATED`): sign in again. */
    public class Unauthenticated(message: String = "Unauthenticated") : AedstError(message)

    /** Signed in but not allowed (Connect `PERMISSION_DENIED`, e.g. a non-admin calling AdminService). */
    public class Forbidden(message: String = "Forbidden") : AedstError(message)
    public class NotFound(message: String = "Not found") : AedstError(message)

    /** The resource changed or already exists (Connect `ABORTED` / `ALREADY_EXISTS`): re-read and retry. */
    public class Conflict(message: String = "Conflict") : AedstError(message)

    /** Throttled by the server (Connect `RESOURCE_EXHAUSTED`); retry later. */
    public class RateLimited(message: String = "Rate limited") : AedstError(message)
    public class InvalidInput(message: String) : AedstError(message)

    /**
     * The server refuses this app build (Connect `FAILED_PRECONDITION` with reason `CLIENT_UPGRADE_REQUIRED`,
     * ADR-0009). Never retryable; `app/` shows the blocking upgrade screen from [ClientUpgradeState], and the server
     * text is dropped (the version numbers are not diagnostic value, the kind is).
     */
    public class UpgradeRequired(message: String = "Client upgrade required") : AedstError(message)
    public class Unknown(message: String, cause: Throwable? = null) : AedstError(message, cause)
}

public inline fun <T, R> Outcome<T>.map(transform: (T) -> R): Outcome<R> = when (this) {
    is Outcome.Success -> Outcome.Success(transform(value))
    is Outcome.Failure -> this
}

public inline fun <T> Outcome<T>.onSuccess(action: (T) -> Unit): Outcome<T> {
    if (this is Outcome.Success) action(value)
    return this
}

public inline fun <T> Outcome<T>.onFailure(action: (AedstError) -> Unit): Outcome<T> {
    if (this is Outcome.Failure) action(error)
    return this
}

public suspend fun <T> runCatchingOutcome(block: suspend () -> T): Outcome<T> = try {
    Outcome.Success(block())
} catch (error: AedstError) {
    Outcome.Failure(error)
} catch (cancellation: CancellationException) {
    throw cancellation
} catch (@Suppress("TooGenericExceptionCaught") throwable: Throwable) {
    Outcome.Failure(AedstError.Unknown(throwable.message ?: "Unknown error", throwable))
}

/** Shared kind name (`error-kinds.json`) of this error. */
public val AedstError.kind: String
    get() = when (this) {
        is AedstError.Unauthenticated -> "unauthenticated"
        is AedstError.Forbidden -> "forbidden"
        is AedstError.NotFound -> "notFound"
        is AedstError.InvalidInput -> "invalidInput"
        is AedstError.Conflict -> "conflict"
        is AedstError.RateLimited -> "rateLimited"
        is AedstError.Unavailable -> "unavailable"
        is AedstError.Offline -> "offline"
        is AedstError.Timeout -> "timeout"
        is AedstError.Cancelled -> "cancelled"
        is AedstError.UpgradeRequired -> "upgradeRequired"
        is AedstError.Storage -> "storage"
        is AedstError.Unknown -> "unknown"
    }

/** Whether retrying the same operation later can plausibly succeed (drives outbox retry vs. give-up). */
public val AedstError.isRetryable: Boolean
    get() = when (this) {
        is AedstError.Unavailable, is AedstError.Offline, is AedstError.RateLimited, is AedstError.Timeout -> true
        else -> false
    }

/** Whether the error is worth a crash-reporter event: a bug or a storage fault, never expected states. */
public val AedstError.isReportable: Boolean
    get() = this is AedstError.Unknown || this is AedstError.Storage
