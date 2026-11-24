import dev.zacsweers.metro.gradle.ExperimentalMetroGradleApi

plugins {
    alias(libs.plugins.android.application.convention)
    alias(libs.plugins.android.compose.convention)
    alias(libs.plugins.android.metro.convention)
    alias(libs.plugins.sentry)
}

// Thin Android TV counterpart to `:app` (the Android-native equivalent of
// Apple's `App_iOS`/`App_macOS` split — see docs/content/android/architecture.md).
// Skips the `google-services` and `baseline-profile` plugins `:app` applies (FCM and a benchmark target are phone-only
// today). The release TLS-pin gate, locale config and LeakCanary come from the application convention plugin.

// Sentry Gradle plugin: only R8 mapping handling, exactly as in :app (the SDK and OkHttp tracing are wired by
// :core:analytics / :core:network). The release APK is minified, so without its mapping a TV crash in Sentry is
// unreadable. Mappings are uploaded only when SENTRY_AUTH_TOKEN (+ SENTRY_ORG / SENTRY_PROJECT) is set.
sentry {
    val hasAuthToken = providers.environmentVariable("SENTRY_AUTH_TOKEN").isPresent
    includeProguardMapping.set(true)
    autoUploadProguardMapping.set(hasAuthToken)
    uploadNativeSymbols.set(false)
    includeSourceContext.set(false)
    autoInstallation { enabled.set(false) }
    tracingInstrumentation { enabled.set(false) }
    telemetry.set(false)
}

// Metro only aggregates contributions of dependencies this module can see. A module that is reachable only through
// another module's `implementation` would be silently missing from the graph; this check fails the build instead.
@OptIn(ExperimentalMetroGradleApi::class)
metro {
    hiddenDependencies {
        checkOnCompile.set(true)
    }
}

android {
    namespace = "com.aedst.android.tv"

    defaultConfig {
        applicationId = "com.aedst.android.tv"
        // OIDC redirect scheme for feature/auth (= applicationId); see :app. Most Android TV devices ship no browser,
        // so the TV signs in with the OAuth device flow (AuthNavGraph(useDeviceFlow = true), no redirect is used);
        // the placeholder is still required by AppAuth's manifest.
        manifestPlaceholders["appAuthRedirectScheme"] = "com.aedst.android.tv"
    }
}

dependencies {
    // Same shared business-logic modules `:app` depends on.
    implementation(project(":core:common"))
    implementation(project(":core:navigation"))
    implementation(project(":core:analytics"))
    // ConnectRPC client, auth interceptors and the API OkHttpClient that feature/auth and capabilities build on.
    implementation(project(":core:network"))
    implementation(project(":core:security"))
    // Capability negotiation (+ the forced-upgrade latch it feeds); Metro only aggregates contributions of direct dependencies.
    implementation(project(":core:capabilities"))
    // Contributes the DataStore<UserPrefs> binding that analytics, capabilities and push read.
    implementation(project(":core:datastore"))

    // TV design system instead of `:core:ui` for TV-specific screens —
    // `:core:ui-tv` re-exposes `:core:ui`'s theme tokens via `api`, so
    // AedstTheme is still available here without a direct dependency.
    implementation(project(":core:ui-tv"))

    implementation(project(":feature:auth"))

    implementation(libs.androidx.core.ktx)
    implementation(libs.compose.activity)
    implementation(libs.navigation3.runtime)
    implementation(libs.navigation3.ui)
    implementation(libs.lifecycle.viewmodel.navigation3)
    // LocalMetroViewModelFactory (provided at the root of the Compose tree) and MetroViewModelFactory.
    implementation(libs.metrox.viewmodel.compose)

    androidTestImplementation(libs.androidx.test.junit)
    androidTestImplementation(libs.androidx.test.espresso)
}
