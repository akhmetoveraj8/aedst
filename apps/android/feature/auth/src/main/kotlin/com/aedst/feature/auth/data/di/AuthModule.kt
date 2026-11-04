package com.aedst.feature.auth.data.di

import android.content.Context
import com.aedst.core.common.ApplicationScope
import com.aedst.core.common.SessionState
import com.aedst.core.common.SessionUser
import com.aedst.core.network.AuthTokenProvider
import com.aedst.core.network.TokenRefresher
import com.aedst.feature.auth.BuildConfig
import com.aedst.feature.auth.data.attestation.ApplicationId
import com.aedst.feature.auth.data.attestation.PlayIntegrityDeviceAttestor
import com.aedst.feature.auth.data.local.AccessTokenClaims
import com.aedst.feature.auth.data.local.AuthTokenStore
import com.aedst.feature.auth.data.oidc.AppAuthOidcAuthorizer
import com.aedst.feature.auth.data.oidc.DeviceEndpointSource
import com.aedst.feature.auth.data.oidc.OidcConfig
import com.aedst.feature.auth.data.oidc.OidcDiscovery
import com.aedst.feature.auth.data.oidc.OkHttpDeviceAuthorizer
import com.aedst.feature.auth.data.oidc.OkHttpTokenRevoker
import com.aedst.feature.auth.data.oidc.RevocationEndpointSource
import com.aedst.feature.auth.data.remote.AuthTokenRefresher
import com.aedst.feature.auth.data.repository.OidcAuthRepository
import com.aedst.feature.auth.domain.repository.AuthRepository
import com.aedst.feature.auth.domain.repository.DeviceAttestor
import com.aedst.feature.auth.domain.repository.DeviceAuthorizer
import com.aedst.feature.auth.domain.repository.OidcAuthorizer
import com.aedst.feature.auth.domain.repository.TokenRevoker
import com.aedst.integrity.v1.IntegrityServiceClient
import com.aedst.integrity.v1.IntegrityServiceClientInterface
import com.connectrpc.ProtocolClientInterface
import dagger.Binds
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import javax.inject.Inject
import javax.inject.Singleton

/**
 * feature/auth's DI seam. This is the one place another module's contract
 * ([AuthTokenProvider], [TokenRefresher] — declared in `core/network` — and
 * [SessionState] — declared in `core/common`) gets an implementation —
 * analogous to `modules/users` calling `auth.api.Service` in-process on the
 * server: the dependency direction is declared where it's consumed, not
 * where it's implemented.
 */
@Module
@InstallIn(SingletonComponent::class)
internal abstract class AuthModule {

    @Binds
    abstract fun bindAuthRepository(impl: OidcAuthRepository): AuthRepository

    @Binds
    abstract fun bindAuthTokenProvider(impl: AuthTokenProviderImpl): AuthTokenProvider

    @Binds
    abstract fun bindTokenRefresher(impl: AuthTokenRefresher): TokenRefresher

    @Binds
    abstract fun bindSessionState(impl: AuthSessionState): SessionState

    @Binds
    abstract fun bindOidcAuthorizer(impl: AppAuthOidcAuthorizer): OidcAuthorizer

    @Binds
    abstract fun bindTokenRevoker(impl: OkHttpTokenRevoker): TokenRevoker

    @Binds
    abstract fun bindRevocationEndpointSource(impl: OidcDiscovery): RevocationEndpointSource

    @Binds
    abstract fun bindDeviceAuthorizer(impl: OkHttpDeviceAuthorizer): DeviceAuthorizer

    @Binds
    abstract fun bindDeviceEndpointSource(impl: OidcDiscovery): DeviceEndpointSource

    @Binds
    abstract fun bindDeviceAttestor(impl: PlayIntegrityDeviceAttestor): DeviceAttestor

    companion object {
        @Provides
        @Singleton
        fun provideIntegrityServiceClient(client: ProtocolClientInterface): IntegrityServiceClientInterface =
            IntegrityServiceClient(client)

        @Provides
        fun provideApplicationId(@ApplicationContext context: Context): ApplicationId =
            ApplicationId(context.packageName)

        /**
         * This build's IdP settings. The redirect scheme is the application id (a reverse-DNS private-use scheme,
         * RFC 8252 section 7.1) and must match the `appAuthRedirectScheme` manifest placeholder of the app module.
         * A plain-http issuer is honoured in debug builds only.
         */
        @Provides
        @Singleton
        fun provideOidcConfig(@ApplicationContext context: Context): OidcConfig = OidcConfig(
            issuer = BuildConfig.OIDC_ISSUER,
            clientId = BuildConfig.OIDC_CLIENT_ID,
            projectId = BuildConfig.OIDC_PROJECT_ID,
            redirectScheme = context.packageName,
            allowCleartextIssuer = BuildConfig.DEBUG && BuildConfig.OIDC_ISSUER.startsWith("http://"),
        )
    }
}

class AuthTokenProviderImpl @Inject constructor(private val tokenStore: AuthTokenStore) : AuthTokenProvider {
    override fun currentAccessToken(): String? = tokenStore.currentAccessToken()
}

/** `null` until the persisted session is restored (hold the splash), then `true`/`false` as the session changes. */
@Singleton
class AuthSessionState @Inject constructor(tokenStore: AuthTokenStore, @ApplicationScope scope: CoroutineScope) :
    SessionState {
    override val isSignedIn: StateFlow<Boolean?> =
        combine(tokenStore.isRestored, tokenStore.session) { restored, session ->
            if (restored) session != null else null
        }.stateIn(scope, SharingStarted.Eagerly, null)

    /** Roles come from the access token (UI gating only) and follow it across refreshes. */
    override val currentUser: StateFlow<SessionUser?> =
        tokenStore.session
            .map { session -> session?.let { SessionUser(it.userId, AccessTokenClaims.roles(it.accessToken)) } }
            .distinctUntilChanged()
            .stateIn(scope, SharingStarted.Eagerly, null)
}
