package com.aedst.feature.auth.domain.repository

import com.aedst.feature.auth.domain.model.DeviceAuthorization
import com.aedst.feature.auth.domain.model.DeviceTokenResult

/**
 * OAuth 2.0 Device Authorization Grant (RFC 8628) for input-constrained devices without a browser (Android TV).
 * Failures (IdP unreachable for good, grant not enabled for the client, no device endpoint in discovery) are thrown
 * as `AedstError`; the three user-visible endings are [DeviceTokenResult].
 */
interface DeviceAuthorizer {
    val isConfigured: Boolean

    /** Requests a device + user code from the IdP's `device_authorization_endpoint`. */
    suspend fun start(): DeviceAuthorization

    /**
     * Polls the token endpoint until the user approves, denies or the code expires. Honours `interval`, adds 5 s on
     * `slow_down`, backs off on transient network errors, and is cancelled by cancelling the caller.
     */
    suspend fun poll(authorization: DeviceAuthorization): DeviceTokenResult
}
