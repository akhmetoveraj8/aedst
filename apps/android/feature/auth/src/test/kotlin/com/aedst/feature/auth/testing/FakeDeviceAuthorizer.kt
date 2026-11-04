package com.aedst.feature.auth.testing

import com.aedst.feature.auth.domain.model.DeviceAuthorization
import com.aedst.feature.auth.domain.model.DeviceTokenResult
import com.aedst.feature.auth.domain.repository.DeviceAuthorizer

/** Scriptable [DeviceAuthorizer]: no HTTP, no waiting. */
class FakeDeviceAuthorizer : DeviceAuthorizer {
    override var isConfigured: Boolean = true
    var authorization = DeviceAuthorization("WDJB-MJHT", "https://idp/device", null, 300, 5, "dev-code")
    var startError: Throwable? = null
    var pollResult: DeviceTokenResult = DeviceTokenResult.Expired
    var pollError: Throwable? = null
    val polled = mutableListOf<DeviceAuthorization>()

    override suspend fun start(): DeviceAuthorization {
        startError?.let { throw it }
        return authorization
    }

    override suspend fun poll(authorization: DeviceAuthorization): DeviceTokenResult {
        polled += authorization
        pollError?.let { throw it }
        return pollResult
    }
}
