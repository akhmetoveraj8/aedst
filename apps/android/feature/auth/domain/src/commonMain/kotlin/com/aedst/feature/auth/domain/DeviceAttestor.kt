package com.aedst.feature.auth.domain

/** Proves to the backend that this is a genuine app on a genuine device. Throws when attestation is not possible. */
public fun interface DeviceAttestor {
    public suspend fun attest(): DeviceAttestation
}
