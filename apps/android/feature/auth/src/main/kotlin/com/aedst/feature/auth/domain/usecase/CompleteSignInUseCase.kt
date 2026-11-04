package com.aedst.feature.auth.domain.usecase

import com.aedst.core.common.DispatcherProvider
import com.aedst.core.common.UseCase
import com.aedst.feature.auth.domain.model.AuthorizationCallback
import com.aedst.feature.auth.domain.model.SignInResult
import com.aedst.feature.auth.domain.repository.AuthRepository
import javax.inject.Inject

/** Step 2 of sign-in: turns what the browser returned into a stored session. */
internal class CompleteSignInUseCase @Inject constructor(
    private val authRepository: AuthRepository,
    dispatcherProvider: DispatcherProvider,
) : UseCase<AuthorizationCallback, SignInResult>(dispatcherProvider) {
    override suspend fun execute(params: AuthorizationCallback): SignInResult = authRepository.completeSignIn(params)
}
