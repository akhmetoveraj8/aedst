plugins {
    alias(libs.plugins.android.feature.convention)
}

android {
    namespace = "com.aedst.feature.notifications"
}

dependencies {
    // The feature's pure domain (Kotlin Multiplatform, commonMain): entities, repository ports, use cases.
    implementation(project(":feature:notifications:domain"))
    implementation(project(":core:network"))
    // Push bookkeeping (server device id, last registered token) lives in the UserPrefs DataStore.
    implementation(project(":core:datastore"))

    // FCM only. The app module applies the google-services plugin when app/google-services.json exists; without
    // it no FirebaseApp is initialised and push is skipped at runtime (FirebaseApp.getApps(...).isEmpty()).
    implementation(platform(libs.firebase.bom))
    implementation(libs.firebase.messaging)
    implementation(libs.kotlinx.coroutines.play.services)

    implementation(libs.androidx.core.ktx)
    implementation(libs.compose.activity)
    implementation(libs.compose.material.icons.extended)

    // Screen tests run on Robolectric + the Compose test rule (JUnit 4, no Jupiter-native equivalent).
    testImplementation(libs.junit.vintage.engine)
}

// Instrumented push-registration test: the real generated client against a MockWebServer, a real FirebaseApp with
// dummy options (no network to Google) and a real DataStore. Run: ./gradlew :feature:notifications:connectedDebugAndroidTest
dependencies {
    androidTestImplementation(libs.androidx.test.junit)
    androidTestImplementation(libs.androidx.test.runner)
    androidTestImplementation(libs.connect.kotlin.okhttp)
    androidTestImplementation(libs.okhttp.core)
    androidTestImplementation(libs.okhttp.mockwebserver)
    androidTestImplementation(libs.kotlinx.coroutines.test)
}
