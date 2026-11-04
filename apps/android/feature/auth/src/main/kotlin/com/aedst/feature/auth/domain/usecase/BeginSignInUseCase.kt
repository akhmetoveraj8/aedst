package com.aedst.feature.auth.domain.usecase

import com.aedst.core.common.DispatcherProvider
import com.aedst.core.common.NoParamsUseCase
import com.aedst.feature.auth.domain.model.BeginSignInResult
import com.aedst.feature.auth.domain.repository.AuthRepository
import javax.inject.Inject

/** Step 1 of sign-in: discovery and the browser launch request. */
internal class BeginSignInUseCase @Inject constructor(
    private val authRepository: AuthRepository,
    dispatcherProvider: DispatcherProvider,
) : NoParamsUseCase<BeginSignInResult>(dispatcherProvider) {
    override suspend fun execute(): BeginSignInResult = authRepository.beginSignIn()
}
