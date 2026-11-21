package com.aedst.feature.auth.domain

import com.aedst.core.common.DispatcherProvider
import com.aedst.core.common.NoParamsUseCase

/** Asks the backend to verify this device after sign-in. Failures come back as `Outcome.Failure`; never blocks sign-in. */
public class AttestDeviceUseCase(private val attestor: DeviceAttestor, dispatcherProvider: DispatcherProvider) :
    NoParamsUseCase<DeviceAttestation>(dispatcherProvider) {
    override suspend fun execute(): DeviceAttestation = attestor.attest()
}
