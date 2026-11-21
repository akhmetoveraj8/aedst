package com.aedst.feature.auth.domain

import com.aedst.core.common.DispatcherProvider
import com.aedst.core.common.UseCase

/** Step 2 of sign-in: turns what the browser returned into a stored session. */
public class CompleteSignInUseCase(
    private val authRepository: AuthRepository,
    dispatcherProvider: DispatcherProvider,
) : UseCase<AuthorizationCallback, SignInResult>(dispatcherProvider) {
    override suspend fun execute(params: AuthorizationCallback): SignInResult = authRepository.completeSignIn(params)
}
