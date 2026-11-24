plugins {
    alias(libs.plugins.android.library.convention)
    alias(libs.plugins.android.metro.convention)
    alias(libs.plugins.kotlin.serialization)
}

// Google Cloud project number linked to the app in Play Console (-Paedst.playIntegrityCloudProject=123456789 or
// env PLAY_INTEGRITY_CLOUD_PROJECT). Unset => 0 => the Play Integrity facade fails fast instead of calling Google.
val playIntegrityCloudProject = providers.gradleProperty("aedst.playIntegrityCloudProject")
    .orElse(providers.environmentVariable("PLAY_INTEGRITY_CLOUD_PROJECT"))
    .orElse("0")

android {
    namespace = "com.aedst.core.security"

    buildFeatures {
        buildConfig = true
    }

    defaultConfig {
        buildConfigField("long", "PLAY_INTEGRITY_CLOUD_PROJECT", "${playIntegrityCloudProject.get().toLong()}L")
    }
}

dependencies {
    implementation(project(":core:common"))

    // Android Keystore-wrapped Tink AEAD (replaces the deprecated androidx.security:security-crypto).
    implementation(libs.tink.android)
    implementation(libs.datastore.core)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.play.integrity)
    implementation(libs.kotlinx.coroutines.core)
    implementation(libs.kotlinx.coroutines.play.services)

    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(libs.mockk)
    // LegacyEncryptedPreferencesMigrationTest runs on Robolectric (JUnit 4 runner): see gradle/libs.versions.toml.
    testImplementation(libs.robolectric)
    testImplementation(libs.androidx.test.core)
    // testImplementation (not runtimeOnly): the vintage engine brings junit:junit 4, whose org.junit API these tests compile against.
    testImplementation(libs.junit.vintage.engine)
}

// Instrumented tests (JUnit 4 by Android's design): the real Android Keystore + Tink store and the Play Integrity
// facade against a fake StandardIntegrityManager. Run: ./gradlew :core:security:connectedDebugAndroidTest
dependencies {
    androidTestImplementation(libs.androidx.test.junit)
    androidTestImplementation(libs.androidx.test.runner)
    androidTestImplementation(libs.kotlinx.coroutines.test)
}
