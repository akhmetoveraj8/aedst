plugins {
    alias(libs.plugins.android.feature.convention)
}

android {
    namespace = "com.aedst.feature.search"
}

dependencies {
    // The feature's pure domain (Kotlin Multiplatform, commonMain): entities, repository ports, use cases.
    implementation(project(":feature:search:domain"))
    implementation(project(":core:network"))
    implementation(project(":core:analytics"))
    implementation(libs.compose.material.icons.extended)

    // Screen tests run on Robolectric + the Compose test rule (JUnit 4, no Jupiter-native equivalent).
    testImplementation(libs.junit.vintage.engine)
}
