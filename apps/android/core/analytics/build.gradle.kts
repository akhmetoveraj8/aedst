plugins {
    alias(libs.plugins.android.library.convention)
    alias(libs.plugins.android.hilt.convention)
}

// Telemetry configuration is per environment and never committed: pass `-Paedst.sentryDsn=...`,
// `-Paedst.posthogKey=...` (and optionally `-Paedst.posthogHost=...`, `-Paedst.environment=...`) from CI secrets or
// ~/.gradle/gradle.properties, or the SENTRY_DSN / POSTHOG_KEY / POSTHOG_HOST environment variables.
// An empty value disables that SDK entirely (no network traffic) — the template builds and runs without accounts.
fun telemetryValue(property: String, env: String, default: String = ""): String =
    providers.gradleProperty(property).orElse(providers.environmentVariable(env)).orElse(default).get()

val sentryDsn = telemetryValue("aedst.sentryDsn", "SENTRY_DSN")
val posthogKey = telemetryValue("aedst.posthogKey", "POSTHOG_KEY")
val posthogHost = telemetryValue("aedst.posthogHost", "POSTHOG_HOST", "https://eu.i.posthog.com")
val environmentName = telemetryValue("aedst.environment", "AEDST_ENVIRONMENT")

android {
    namespace = "com.aedst.core.analytics"

    buildFeatures {
        buildConfig = true
    }

    defaultConfig {
        buildConfigField("String", "SENTRY_DSN", "\"$sentryDsn\"")
        buildConfigField("String", "POSTHOG_KEY", "\"$posthogKey\"")
        buildConfigField("String", "POSTHOG_HOST", "\"$posthogHost\"")
    }

    buildTypes {
        debug {
            buildConfigField("String", "ENVIRONMENT", "\"${environmentName.ifEmpty { "development" }}\"")
        }
        release {
            buildConfigField("String", "ENVIRONMENT", "\"${environmentName.ifEmpty { "production" }}\"")
        }
    }
}

dependencies {
    implementation(project(":core:common"))
    implementation(project(":core:network"))
    implementation(project(":core:datastore"))

    // Crash/error reporting + OkHttp tracing (one aligned io.sentry version; screen breadcrumbs are added by hand).
    implementation(platform(libs.sentry.bom))
    implementation(libs.sentry.android)
    implementation(libs.sentry.okhttp)
    // Product analytics + feature flags, consent-gated.
    implementation(libs.posthog.android)

    implementation(libs.okhttp.core)
    implementation(libs.kotlinx.coroutines.android)
}
