plugins {
    alias(libs.plugins.android.application.convention)
    alias(libs.plugins.android.compose.convention)
    alias(libs.plugins.android.hilt.convention)
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
    implementation(project(":core:security"))
    // Capability negotiation (+ the forced-upgrade latch it feeds); Hilt needs the module on the app classpath.
    implementation(project(":core:capabilities"))

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

    androidTestImplementation(libs.androidx.test.junit)
    androidTestImplementation(libs.androidx.test.espresso)
}
