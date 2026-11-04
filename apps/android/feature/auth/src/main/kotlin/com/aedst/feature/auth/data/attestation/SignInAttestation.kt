package com.aedst.feature.auth.data.attestation

import com.aedst.core.analytics.AnalyticsTracker
import com.aedst.core.common.ApplicationScope
import com.aedst.core.common.Logger
import com.aedst.core.common.onFailure
import com.aedst.core.common.onSuccess
import com.aedst.feature.auth.domain.usecase.AttestDeviceUseCase
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import java.util.concurrent.atomic.AtomicReference
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Fire-and-forget device attestation once per successful sign-in. It runs on the application scope, never throws and
 * never delays or alters sign-in. The outcome is informational: an analytics event (consent applies) carrying only
 * `verified`, `reason` and `device`; every failure (server disabled, no cloud project, no Play Services, offline) is
 * a debug log. A run already in flight absorbs further triggers (per-process throttle).
 */
@Singleton
internal class SignInAttestation @Inject constructor(
    private val attestDevice: AttestDeviceUseCase,
    private val analytics: AnalyticsTracker,
    private val logger: Logger,
    @ApplicationScope private val scope: CoroutineScope,
) {
    private val inFlight = AtomicReference<Job?>(null)

    fun onSignedIn() {
        if (inFlight.get()?.isActive == true) return
        inFlight.set(
            scope.launch {
                attestDevice()
                    .onSuccess {
                        analytics.logEvent(
                            EVENT,
                            mapOf("verified" to it.verified, "reason" to it.reason, "device" to it.deviceVerdict),
                        )
                    }
                    .onFailure { logger.debug(TAG, "Device attestation skipped: ${it::class.simpleName}") }
            },
        )
    }

    private companion object {
        const val TAG = "SignInAttestation"
        const val EVENT = "device_attestation"
    }
}
