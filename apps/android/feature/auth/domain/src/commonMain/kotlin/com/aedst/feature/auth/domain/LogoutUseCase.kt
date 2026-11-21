package com.aedst.feature.auth.domain

import com.aedst.core.common.DispatcherProvider
import com.aedst.core.common.NoParamsUseCase

public class LogoutUseCase(private val authRepository: AuthRepository, dispatcherProvider: DispatcherProvider) :
    NoParamsUseCase<Unit>(dispatcherProvider) {
    override suspend fun execute(): Unit = authRepository.logout()
}
