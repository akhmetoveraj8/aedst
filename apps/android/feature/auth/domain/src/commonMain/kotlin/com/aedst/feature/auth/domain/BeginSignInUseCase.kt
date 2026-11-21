package com.aedst.feature.auth.domain

import com.aedst.core.common.DispatcherProvider
import com.aedst.core.common.NoParamsUseCase

/** Step 1 of sign-in: discovery and the browser launch request. */
public class BeginSignInUseCase(private val authRepository: AuthRepository, dispatcherProvider: DispatcherProvider) :
    NoParamsUseCase<BeginSignInResult>(dispatcherProvider) {
    override suspend fun execute(): BeginSignInResult = authRepository.beginSignIn()
}
