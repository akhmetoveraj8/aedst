package com.aedst.feature.auth.data.attestation

import com.aedst.core.network.rpc
import com.aedst.core.security.IntegrityFacade
import com.aedst.feature.auth.domain.model.DeviceAttestation
import com.aedst.feature.auth.domain.repository.DeviceAttestor
import com.aedst.integrity.v1.DeviceVerdict
import com.aedst.integrity.v1.IntegrityServiceClientInterface
import com.aedst.integrity.v1.verifyIntegrityTokenRequest
import com.google.protobuf.ByteString
import java.security.SecureRandom
import javax.inject.Inject

/** The applicationId of this build, sent as `package_name` so the server can check it against its allow-list. */
data class ApplicationId(val value: String)

/**
 * Play Integrity attestation: a fresh random payload is bound into the token through the request hash, the opaque
 * token goes to `IntegrityService.VerifyIntegrityToken`, and the server verdict is returned. A rejected token is a
 * normal response (`verified = false` plus a reason); every other problem (no cloud project, no Play Services,
 * offline, server disabled = FAILED_PRECONDITION) is thrown for the caller to swallow.
 */
class PlayIntegrityDeviceAttestor @Inject constructor(
    private val facade: IntegrityFacade,
    private val client: IntegrityServiceClientInterface,
    private val applicationId: ApplicationId,
) : DeviceAttestor {
    private val random = SecureRandom()

    override suspend fun attest(): DeviceAttestation {
        val nonce = ByteArray(PAYLOAD_BYTES).also(random::nextBytes)
        val hash = IntegrityRequestHash.compute(ACTION, nonce)
        val token = facade.requestIntegrityToken(hash).getOrThrow()
        val response = rpc {
            client.verifyIntegrityToken(
                verifyIntegrityTokenRequest {
                    integrityToken = token
                    action = ACTION
                    payload = ByteString.copyFrom(nonce)
                    requestHash = hash
                    packageName = applicationId.value
                },
            )
        }
        return DeviceAttestation(
            verified = response.verified,
            reason = if (response.verified) "" else response.reason.name.removePrefix("FAILURE_REASON_").lowercase(),
            deviceVerdict = response.deviceVerdictsList.maxByOrNull(::rank)?.name.orEmpty()
                .removePrefix("DEVICE_VERDICT_").lowercase(),
        )
    }

    private fun rank(verdict: DeviceVerdict): Int = when (verdict) {
        DeviceVerdict.DEVICE_VERDICT_MEETS_STRONG_INTEGRITY -> 3
        DeviceVerdict.DEVICE_VERDICT_MEETS_DEVICE_INTEGRITY -> 2
        DeviceVerdict.DEVICE_VERDICT_MEETS_BASIC_INTEGRITY -> 1
        else -> 0
    }

    private companion object {
        const val ACTION = "login"
        const val PAYLOAD_BYTES = 16
    }
}
