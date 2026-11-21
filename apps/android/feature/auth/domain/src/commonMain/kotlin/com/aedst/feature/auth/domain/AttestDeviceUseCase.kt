package com.aedst.feature.auth.domain.usecase

import com.aedst.core.common.DispatcherProvider
import com.aedst.core.common.NoParamsUseCase
import com.aedst.feature.auth.domain.model.DeviceAttestation
import com.aedst.feature.auth.domain.repository.DeviceAttestor
import javax.inject.Inject

/** Asks the backend to verify this device after sign-in. Failures come back as `Outcome.Failure`; never blocks sign-in. */
internal class AttestDeviceUseCase @Inject constructor(
    private val attestor: DeviceAttestor,
    dispatcherProvider: DispatcherProvider,
) : NoParamsUseCase<DeviceAttestation>(dispatcherProvider) {
    override suspend fun execute(): DeviceAttestation = attestor.attest()
}
