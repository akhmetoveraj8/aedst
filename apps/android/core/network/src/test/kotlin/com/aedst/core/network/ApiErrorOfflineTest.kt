package com.aedst.core.network

import com.aedst.core.common.AedstError
import com.connectrpc.Code
import com.connectrpc.ConnectException
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.net.SocketTimeoutException
import java.net.UnknownHostException

class ApiErrorOfflineTest {

    @Test
    fun `unknown host maps to Offline`() {
        assertTrue(UnknownHostException("api.aedst.example").toAedstError() is AedstError.Offline)
    }

    @Test
    fun `socket timeout maps to Timeout, not Offline`() {
        assertTrue(SocketTimeoutException("timeout").toAedstError() is AedstError.Timeout)
    }

    @Test
    fun `Connect failure caused by an unknown host maps to Offline`() {
        val error = ConnectException(code = Code.UNAVAILABLE, exception = UnknownHostException("api.aedst.example"))

        assertTrue(error.toAedstError() is AedstError.Offline)
    }

    @Test
    fun `an AedstError passes through unchanged`() {
        val original = AedstError.NotFound()

        assertTrue(original.toAedstError() === original)
    }
}
