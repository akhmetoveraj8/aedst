package com.aedst.feature.auth.data.remote

import com.aedst.core.common.Logger
import com.aedst.core.common.SignOutHook
import kotlinx.coroutines.CancellationException

/**
 * Runs [action] on every hook, best effort: a failing hook is logged by kind and never blocks sign-out or the
 * session-ended cleanup of the others. Cancellation is rethrown.
 */
internal suspend fun Iterable<SignOutHook>.runEach(
    logger: Logger,
    tag: String,
    action: suspend (SignOutHook) -> Unit,
) {
    forEach { hook ->
        try {
            action(hook)
        } catch (cancellation: CancellationException) {
            throw cancellation
        } catch (@Suppress("TooGenericExceptionCaught") failure: Throwable) {
            logger.warn(tag, "A sign-out hook failed: ${hook::class.simpleName}", failure)
        }
    }
}
