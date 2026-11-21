package com.aedst.feature.auth.domain.repository

import com.aedst.feature.auth.domain.model.DeviceAttestation

/** Proves to the backend that this is a genuine app on a genuine device. Throws when attestation is not possible. */
fun interface DeviceAttestor {
    suspend fun attest(): DeviceAttestation
}
