package com.aedst.feature.auth.data.oidc

import com.aedst.core.common.AedstError
import net.openid.appauth.AuthorizationException
import net.openid.appauth.AuthorizationException.AuthorizationRequestErrors
import net.openid.appauth.AuthorizationException.GeneralErrors
import net.openid.appauth.AuthorizationException.TokenRequestErrors
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.net.SocketTimeoutException
import java.net.UnknownHostException

/** Robolectric because AppAuth error classes use `android.util.ArrayMap` in their static initialisers. */
@RunWith(RobolectricTestRunner::class)
class AuthorizationErrorsTest {

    @Test
    fun `only the user backing out is a cancellation`() {
        assertTrue(GeneralErrors.USER_CANCELED_AUTH_FLOW.isUserCancellation())
        assertFalse(GeneralErrors.PROGRAM_CANCELED_AUTH_FLOW.isUserCancellation())
        assertFalse(AuthorizationRequestErrors.ACCESS_DENIED.isUserCancellation())
    }

    @Test
    fun `access_denied is Forbidden`() {
        assertTrue(AuthorizationRequestErrors.ACCESS_DENIED.toSignInError() is AedstError.Forbidden)
    }

    @Test
    fun `an unknown host is Offline and a socket timeout is Timeout`() {
        val offline = AuthorizationException.fromTemplate(GeneralErrors.NETWORK_ERROR, UnknownHostException("idp"))
        val timeout = AuthorizationException.fromTemplate(GeneralErrors.NETWORK_ERROR, SocketTimeoutException("slow"))

        assertTrue(offline.toSignInError() is AedstError.Offline)
        assertTrue(timeout.toSignInError() is AedstError.Timeout)
    }

    @Test
    fun `IdP-side transient failures are Network`() {
        assertTrue(AuthorizationRequestErrors.SERVER_ERROR.toSignInError() is AedstError.Unavailable)
        assertTrue(AuthorizationRequestErrors.TEMPORARILY_UNAVAILABLE.toSignInError() is AedstError.Unavailable)
        assertTrue(GeneralErrors.SERVER_ERROR.toSignInError() is AedstError.Unavailable)
        assertTrue(GeneralErrors.JSON_DESERIALIZATION_ERROR.toSignInError() is AedstError.Unavailable)
        assertTrue(TokenRequestErrors.OTHER.toSignInError() is AedstError.Unavailable)
    }

    @Test
    fun `invalid_grant is the definitive Unauthorized`() {
        assertTrue(TokenRequestErrors.INVALID_GRANT.toSignInError() is AedstError.Unauthenticated)
    }

    @Test
    fun `ID token validation failure and state mismatch are Unauthorized`() {
        assertTrue(GeneralErrors.ID_TOKEN_VALIDATION_ERROR.toSignInError() is AedstError.Unauthenticated)
        assertTrue(AuthorizationRequestErrors.STATE_MISMATCH.toSignInError() is AedstError.Unauthenticated)
    }

    @Test
    fun `client misconfiguration is Unknown, not a signed-out session`() {
        assertTrue(TokenRequestErrors.INVALID_CLIENT.toSignInError() is AedstError.Unknown)
        assertTrue(TokenRequestErrors.UNAUTHORIZED_CLIENT.toSignInError() is AedstError.Unknown)
        assertTrue(AuthorizationRequestErrors.INVALID_SCOPE.toSignInError() is AedstError.Unknown)
    }

    @Test
    fun `a malformed token request is Validation`() {
        assertTrue(TokenRequestErrors.INVALID_REQUEST.toSignInError() is AedstError.InvalidInput)
    }

    @Test
    fun `the diagnostic message names the OAuth error`() {
        assertTrue(TokenRequestErrors.INVALID_GRANT.toSignInError().message.contains("invalid_grant"))
    }
}
