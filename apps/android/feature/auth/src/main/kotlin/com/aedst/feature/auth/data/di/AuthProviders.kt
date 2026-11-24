package com.aedst.feature.auth.data.di

import android.content.Context
import com.aedst.core.common.ApplicationContext
import com.aedst.core.common.ApplicationScope
import com.aedst.core.common.DispatcherProvider
import com.aedst.core.common.SessionState
import com.aedst.core.common.SessionUser
import com.aedst.core.network.AuthTokenProvider
import com.aedst.feature.auth.BuildConfig
import com.aedst.feature.auth.data.attestation.ApplicationId
import com.aedst.feature.auth.data.local.AccessTokenClaims
import com.aedst.feature.auth.data.local.AuthTokenStore
import com.aedst.feature.auth.data.oidc.OidcConfig
import com.aedst.feature.auth.domain.AttestDeviceUseCase
import com.aedst.feature.auth.domain.AuthRepository
import com.aedst.feature.auth.domain.AwaitDeviceSignInUseCase
import com.aedst.feature.auth.domain.BeginDeviceSignInUseCase
import com.aedst.feature.auth.domain.BeginSignInUseCase
import com.aedst.feature.auth.domain.CompleteSignInUseCase
import com.aedst.feature.auth.domain.DeviceAttestor
import com.aedst.feature.auth.domain.LogoutUseCase
import com.aedst.integrity.v1.IntegrityServiceClient
import com.aedst.integrity.v1.IntegrityServiceClientInterface
import com.connectrpc.ProtocolClientInterface
import dev.zacsweers.metro.AppScope
import dev.zacsweers.metro.BindingContainer
import dev.zacsweers.metro.ContributesBinding
import dev.zacsweers.metro.ContributesTo
import dev.zacsweers.metro.Inject
import dev.zacsweers.metro.Provides
import dev.zacsweers.metro.SingleIn
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn

/**
 * feature/auth's DI seam. This is the one place another module's contract
 * ([AuthTokenProvider], `TokenRefresher` — declared in `core/network` — and
 * [SessionState] — declared in `core/common`) gets an implementation —
 * analogous to `modules/users` calling `auth.api.Service` in-process on the
 * server: the dependency direction is declared where it's consumed, not
 * where it's implemented.
 *
 * The interface bindings are `@ContributesBinding` on the implementing classes (their own files, or below). What stays
 * here are the `@Provides`: Metro follows Kotlin visibility, so a container another module aggregates is public
 * (and only mentions public types), while the classes it exposes through bindings can stay `internal`.
 */
@BindingContainer
@ContributesTo(AppScope::class)
object AuthProviders {

    @Provides
    @SingleIn(AppScope::class)
    fun provideIntegrityServiceClient(client: ProtocolClientInterface): IntegrityServiceClientInterface =
        IntegrityServiceClient(client)

    @Provides
    fun provideApplicationId(@ApplicationContext context: Context): ApplicationId = ApplicationId(context.packageName)

    /**
     * This build's IdP settings. The redirect scheme is the application id (a reverse-DNS private-use scheme,
     * RFC 8252 section 7.1) and must match the `appAuthRedirectScheme` manifest placeholder of the app module.
     * A plain-http issuer is honoured in debug builds only.
     */
    @Provides
    @SingleIn(AppScope::class)
    fun provideOidcConfig(@ApplicationContext context: Context): OidcConfig = OidcConfig(
        issuer = BuildConfig.OIDC_ISSUER,
        clientId = BuildConfig.OIDC_CLIENT_ID,
        projectId = BuildConfig.OIDC_PROJECT_ID,
        redirectScheme = context.packageName,
        allowCleartextIssuer = BuildConfig.DEBUG && BuildConfig.OIDC_ISSUER.startsWith("http://"),
    )

    // Use cases live in the common-code domain module, which has no DI annotations: they are constructed here.
    @Provides
    fun provideBeginSignInUseCase(repository: AuthRepository, dispatchers: DispatcherProvider): BeginSignInUseCase =
        BeginSignInUseCase(repository, dispatchers)

    @Provides
    fun provideCompleteSignInUseCase(
        repository: AuthRepository,
        dispatchers: DispatcherProvider,
    ): CompleteSignInUseCase = CompleteSignInUseCase(repository, dispatchers)

    @Provides
    fun provideBeginDeviceSignInUseCase(
        repository: AuthRepository,
        dispatchers: DispatcherProvider,
    ): BeginDeviceSignInUseCase = BeginDeviceSignInUseCase(repository, dispatchers)

    @Provides
    fun provideAwaitDeviceSignInUseCase(
        repository: AuthRepository,
        dispatchers: DispatcherProvider,
    ): AwaitDeviceSignInUseCase = AwaitDeviceSignInUseCase(repository, dispatchers)

    @Provides
    fun provideLogoutUseCase(repository: AuthRepository, dispatchers: DispatcherProvider): LogoutUseCase =
        LogoutUseCase(repository, dispatchers)

    @Provides
    fun provideAttestDeviceUseCase(attestor: DeviceAttestor, dispatchers: DispatcherProvider): AttestDeviceUseCase =
        AttestDeviceUseCase(attestor, dispatchers)
}

@ContributesBinding(AppScope::class)
@Inject
class AuthTokenProviderImpl(private val tokenStore: AuthTokenStore) : AuthTokenProvider {
    override fun currentAccessToken(): String? = tokenStore.currentAccessToken()
}

/** `null` until the persisted session is restored (hold the splash), then `true`/`false` as the session changes. */
@SingleIn(AppScope::class)
@ContributesBinding(AppScope::class)
@Inject
class AuthSessionState(tokenStore: AuthTokenStore, @ApplicationScope scope: CoroutineScope) : SessionState {
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
