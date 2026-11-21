plugins {
    alias(libs.plugins.android.feature.convention)
    alias(libs.plugins.kotlin.serialization)
}

// OIDC (Authorization Code + PKCE) configuration, per environment and never committed: pass
// `-Paedst.oidc.issuer=... -Paedst.oidc.clientId=... -Paedst.oidc.projectId=...` (CI secret or
// ~/.gradle/gradle.properties)
// or the matching AEDST_OIDC_* environment variables. An empty client id or issuer is a supported state: the sign-in
// screen then says "sign-in is not configured" instead of crashing (see OidcConfig.isConfigured). The project id is
// the ZITADEL project whose id must be in the access token audience (scope urn:zitadel:iam:org:project:id:<id>:aud).
fun oidcProperty(name: String, envName: String) =
    providers.gradleProperty(name).orElse(providers.environmentVariable(envName)).orElse("")

val oidcIssuer = oidcProperty("aedst.oidc.issuer", "AEDST_OIDC_ISSUER")
val oidcClientId = oidcProperty("aedst.oidc.clientId", "AEDST_OIDC_CLIENT_ID")
val oidcProjectId = oidcProperty("aedst.oidc.projectId", "AEDST_OIDC_PROJECT_ID")

// Debug builds default to the local ZITADEL of `docker compose --profile idp` as seen from the emulator
// (10.0.2.2 is the host's loopback). It is plain http, which needs a debug-only cleartext exception, see
// apps/server/deployments/zitadel/android-app.md.
val debugIssuerDefault = "http://10.0.2.2:8085"

android {
    namespace = "com.aedst.feature.auth"

    defaultConfig {
        // AppAuth declares RedirectUriReceiverActivity with this placeholder; the apps override it with their
        // applicationId. This value only lets the library own unit-test manifest merge succeed.
        manifestPlaceholders["appAuthRedirectScheme"] = "com.aedst.android"
    }

    buildFeatures {
        buildConfig = true
    }

    buildTypes {
        debug {
            buildConfigField("String", "OIDC_ISSUER", "\"${oidcIssuer.get().ifBlank { debugIssuerDefault }}\"")
            buildConfigField("String", "OIDC_CLIENT_ID", "\"${oidcClientId.get()}\"")
            buildConfigField("String", "OIDC_PROJECT_ID", "\"${oidcProjectId.get()}\"")
        }
        release {
            buildConfigField("String", "OIDC_ISSUER", "\"${oidcIssuer.get()}\"")
            buildConfigField("String", "OIDC_CLIENT_ID", "\"${oidcClientId.get()}\"")
            buildConfigField("String", "OIDC_PROJECT_ID", "\"${oidcProjectId.get()}\"")
        }
    }
}

dependencies {
    // The feature's pure domain (Kotlin Multiplatform, commonMain): entities, repository ports, use cases.
    implementation(project(":feature:auth:domain"))
    implementation(project(":core:network"))
    implementation(project(":core:security"))
    implementation(project(":core:analytics"))

    // Native OIDC client (RFC 8252/7636): Custom Tab + PKCE + token endpoint calls. Library-First: approved library.
    implementation(libs.androidx.core.ktx) // androidx.core.net.toUri
    implementation(libs.appauth)
    // RFC 7009 revocation on sign-out goes through the app's already-approved HTTP client (core/network's
    // @ExternalHttpClient), so the OkHttp API must be visible here.
    implementation(libs.okhttp.core)
    implementation(libs.okhttp.coroutines)
    implementation(libs.compose.activity)
    implementation(libs.kotlinx.serialization.json)

    testImplementation(libs.okhttp.mockwebserver)
    // LoginScreenTest + AuthorizationErrorsTest run on Robolectric (JUnit 4 runner): see gradle/libs.versions.toml.
    testRuntimeOnly(libs.junit.vintage.engine)
}

// Cross-platform behaviour fixtures (docs/contract/behavior) are the single source: put the directory itself on the
// unit-test classpath instead of copying the files (see core/testing's BehaviorFixture).
android {
    sourceSets {
        getByName("test").resources.directories.add(
            rootProject.layout.projectDirectory.dir("../../docs/contract/behavior").asFile.absolutePath,
        )
    }
}

// Instrumented token-store test on the real Keystore + Tink store (JUnit 4 by Android's design).
// Run: ./gradlew :feature:auth:connectedDebugAndroidTest
dependencies {
    androidTestImplementation(libs.kotlinx.coroutines.test)
}
