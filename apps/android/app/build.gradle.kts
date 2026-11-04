plugins {
    alias(libs.plugins.android.application.convention)
    alias(libs.plugins.android.compose.convention)
    alias(libs.plugins.android.hilt.convention)
    alias(libs.plugins.sentry)
    alias(libs.plugins.baseline.profile)
}

// FCM: the google-services plugin needs app/google-services.json (gitignored, per Firebase project). Apply it only
// when the file exists so the template builds without a Firebase project; at runtime push is then skipped
// (feature/notifications checks FirebaseApp.getApps()). CI copies google-services.json.example to exercise it.
if (file("google-services.json").exists()) {
    apply(plugin = libs.plugins.google.services.get().pluginId)
}

// Sentry Gradle plugin: only R8 mapping handling. The SDK is added explicitly (core/analytics) and OkHttp is
// instrumented explicitly (core/network's HttpTelemetry seam), so bytecode instrumentation and auto-installation
// are off. Mappings are uploaded only when SENTRY_AUTH_TOKEN (+ SENTRY_ORG / SENTRY_PROJECT) is set — local and
// fork builds never need a Sentry account.
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

// The `benchmark/` module generates this app's baseline profile
// (`./gradlew :app:generateBaselineProfile`, device/emulator required; nightly/manual lane in
// .github/workflows/android-nightly.yml). See apps/android/README.md.
baselineProfile {
    // Where a recorded profile goes: app/src/release/generated/baselineProfiles, committed so ordinary release builds need
    // no device. NO PROFILE HAS BEEN RECORDED YET (generation needs a device or emulator), so release builds currently
    // ship without one; android-ci reports the missing folder (AEDST_REQUIRE_BASELINE_PROFILE=1 turns that into a failure).
    saveInSrc = true
    // Generation needs a device, so a release build must never trigger it implicitly (CI builds release without one).
    automaticGenerationDuringBuild = false
    // Reorders classes in the dex by the startup profile (the benchmark records one: includeInStartupProfile).
    dexLayoutOptimization = true
    // Only app code goes into the generated profile; Compose, OkHttp etc. ship and merge their own profiles.
    filter {
        include("com.aedst.**")
    }
}

android {
    namespace = "com.aedst.android"

    defaultConfig {
        applicationId = "com.aedst.android"
        // OIDC redirect scheme (RFC 8252 7.1) for feature/auth's AppAuth RedirectUriReceiverActivity: must equal the
        // applicationId (the redirect URI is "<applicationId>:/oauth2redirect") and be registered at the IdP.
        manifestPlaceholders["appAuthRedirectScheme"] = "com.aedst.android"
        // Host of the Android App Links intent filter (the web app's domain, which serves /.well-known/assetlinks.json).
        // `-Paedst.appLinkHost=app.example.com`; the default is a placeholder that no real domain verifies.
        manifestPlaceholders["appLinkHost"] =
            providers.gradleProperty("aedst.appLinkHost").orElse("app.aedst.example").get()
    }
}

// The release TLS-pin gate (`preReleaseBuild` -> `:core:network:verifyReleaseCertPins`) comes from the application
// convention plugin, for this module and for app-tv alike.

dependencies {
    implementation(project(":core:common"))
    implementation(project(":core:ui"))
    implementation(project(":core:navigation"))
    implementation(project(":core:analytics"))
    implementation(project(":core:security"))
    implementation(project(":core:network"))
    implementation(project(":core:capabilities"))
    implementation(project(":core:database"))
    implementation(project(":core:outbox"))
    implementation(project(":core:media"))

    implementation(project(":feature:auth"))
    implementation(project(":feature:tasks"))
    implementation(project(":feature:search"))
    implementation(project(":feature:notifications"))
    implementation(project(":feature:media"))
    implementation(project(":feature:admin"))

    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.splashscreen)
    implementation(libs.compose.activity)
    implementation(libs.compose.material.icons.extended)
    implementation(libs.navigation3.runtime)
    implementation(libs.navigation3.ui)
    // Per-entry ViewModelStore (entry decorator) so hiltViewModel() inside a screen is scoped to its back stack entry.
    implementation(libs.lifecycle.viewmodel.navigation3)
    // NavigationSuiteScaffold: bottom bar on phones, rail on tablets/foldables.
    implementation(libs.compose.material3.adaptive.navigation.suite)
    implementation(libs.workmanager.runtime)
    implementation(libs.hilt.work)

    androidTestImplementation(libs.androidx.test.junit)
    androidTestImplementation(libs.androidx.test.espresso)

    "baselineProfile"(project(":benchmark"))
    implementation(libs.androidx.profileinstaller)
}
