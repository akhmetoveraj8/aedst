package com.aedst.feature.auth.domain.usecase

import com.aedst.core.common.DispatcherProvider
import com.aedst.core.common.NoParamsUseCase
import com.aedst.core.common.UseCase
import com.aedst.feature.auth.domain.model.DeviceAuthorization
import com.aedst.feature.auth.domain.model.DeviceSignInResult
import com.aedst.feature.auth.domain.repository.AuthRepository
import javax.inject.Inject

/** Device flow step 1: asks the IdP for the user code to show on the TV. */
internal class BeginDeviceSignInUseCase @Inject constructor(
    private val authRepository: AuthRepository,
    dispatcherProvider: DispatcherProvider,
) : NoParamsUseCase<DeviceAuthorization>(dispatcherProvider) {
    override suspend fun execute(): DeviceAuthorization = authRepository.beginDeviceSignIn()
}

/** Device flow step 2: polls until the user approves on another device, then stores the session. */
internal class AwaitDeviceSignInUseCase @Inject constructor(
    private val authRepository: AuthRepository,
    dispatcherProvider: DispatcherProvider,
) : UseCase<DeviceAuthorization, DeviceSignInResult>(dispatcherProvider) {
    override suspend fun execute(params: DeviceAuthorization): DeviceSignInResult =
        authRepository.awaitDeviceSignIn(params)
}
