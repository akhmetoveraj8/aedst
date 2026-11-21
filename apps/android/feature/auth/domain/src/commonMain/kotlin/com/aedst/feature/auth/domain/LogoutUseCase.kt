package com.aedst.feature.auth.domain.usecase

import com.aedst.core.common.DispatcherProvider
import com.aedst.core.common.NoParamsUseCase
import com.aedst.feature.auth.domain.repository.AuthRepository
import javax.inject.Inject

internal class LogoutUseCase @Inject constructor(
    private val authRepository: AuthRepository,
    dispatcherProvider: DispatcherProvider,
) : NoParamsUseCase<Unit>(dispatcherProvider) {
    override suspend fun execute() = authRepository.logout()
}
