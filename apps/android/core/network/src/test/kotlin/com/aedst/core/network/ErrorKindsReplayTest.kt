package com.aedst.core.network

import com.aedst.core.common.AedstError
import com.aedst.core.common.isReportable
import com.aedst.core.common.isRetryable
import com.aedst.core.common.kind
import com.aedst.core.testing.BehaviorFixture
import com.connectrpc.Code
import com.connectrpc.ConnectException
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import java.net.SocketTimeoutException
import java.net.UnknownHostException

/**
 * Replays docs/contract/behavior/error-kinds.json against the real Connect-code mapping ([toAedstError]) and the
 * [AedstError] flags: every case must land on the shared kind with the shared retryable/reportable flags, and every
 * kind of the vocabulary must carry the declared flags.
 */
class ErrorKindsReplayTest {

    private val fixture = BehaviorFixture.load("error-kinds")

    private fun JsonObject.str(key: String) = getValue(key).jsonPrimitive.content

    private fun codeNamed(name: String): Code =
        checkNotNull(Code.values().firstOrNull { it.codeName == name }) { "unknown Connect code $name" }

    private fun failureFor(case: JsonObject): Throwable? {
        case["transport"]?.let {
            return when (it.jsonPrimitive.content) {
                "offline" -> UnknownHostException("api.aedst.example")
                "timeout" -> SocketTimeoutException("timeout")
                else -> null // aborted: coroutine cancellation is rethrown, never an AedstError; storage: local
            }
        }
        val code = codeNamed(case.str("code"))
        val reason = case["reason"]?.jsonPrimitive?.content
        return if (reason != null && code == Code.FAILED_PRECONDITION) {
            UpgradeFixtures.exceptionWith(reason)
        } else {
            ConnectException(code = code, message = "diagnostic")
        }
    }

    private fun AedstError.flags() = Triple(kind, isRetryable, isReportable)

    @Test
    fun `every case maps to the shared kind and flags`() {
        fixture.getValue("cases").jsonArray.map { it.jsonObject }.forEach { case ->
            val expect = case.getValue("expect").jsonObject
            val failure = failureFor(case)
            val got = when {
                failure != null -> failure.toAedstError().flags()
                // Platform-local sources the Connect mapper does not produce: caller abort and a database fault.
                case.str("transport") == "aborted" -> AedstError.Cancelled().flags()
                else -> AedstError.Storage("db").flags()
            }
            assertEquals(
                Triple(
                    expect.str("kind"),
                    expect.getValue("retryable").jsonPrimitive.boolean,
                    expect.getValue("reportable").jsonPrimitive.boolean,
                ),
                got,
                case.str("id"),
            )
        }
    }

    @Test
    fun `every kind of the vocabulary has a case in AedstError carrying the declared flags`() {
        val samples = listOf(
            AedstError.Unauthenticated(), AedstError.Forbidden(), AedstError.NotFound(), AedstError.InvalidInput("x"),
            AedstError.Conflict(), AedstError.RateLimited(), AedstError.Unavailable("x"), AedstError.Offline(),
            AedstError.Timeout(), AedstError.Cancelled(), AedstError.UpgradeRequired(), AedstError.Storage("x"),
            AedstError.Unknown("x"),
        ).associateBy { it.kind }
        val kinds = fixture.getValue("kinds").jsonObject
        assertEquals(kinds.keys, samples.keys)
        kinds.forEach { (kind, flags) ->
            val error = samples.getValue(kind)
            assertEquals(flags.jsonObject.getValue("retryable").jsonPrimitive.boolean, error.isRetryable, kind)
            assertEquals(flags.jsonObject.getValue("reportable").jsonPrimitive.boolean, error.isReportable, kind)
        }
    }
}
