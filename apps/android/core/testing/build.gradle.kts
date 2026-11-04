plugins {
    alias(libs.plugins.android.library.convention)
}

android {
    namespace = "com.aedst.core.testing"
}

dependencies {
    api(project(":core:common"))
    // JUnit 6 API for MainDispatcherExtension (a Jupiter extension); the engine comes from aedst.android.library.
    api(platform(libs.junit.bom))
    api(libs.junit.jupiter.api)
    api(libs.mockk)
    api(libs.mockk.android)
    api(libs.turbine)
    // BehaviorFixture parses docs/contract/behavior/*.json for the fixture-replay tests.
    api(libs.kotlinx.serialization.json)
    // assertScreenSemantics: the Compose test rule and semantics APIs (BOM-managed, same as the compose convention).
    api(platform(libs.compose.bom))
    api(libs.compose.ui.test.junit4)
    api(libs.kotlinx.coroutines.test)
    implementation(libs.kotlinx.coroutines.core)
}
