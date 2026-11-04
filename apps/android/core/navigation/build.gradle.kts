plugins {
    alias(libs.plugins.android.library.convention)
    alias(libs.plugins.android.compose.convention)
    alias(libs.plugins.kotlin.serialization)
}

android {
    namespace = "com.aedst.core.navigation"
}

dependencies {
    implementation(project(":core:common"))
    // Navigation 3 runtime (NavKey, NavBackStack, EntryProviderScope) is part of this module's public contract:
    // every feature registers its destinations on an EntryProviderScope<NavKey>.
    api(libs.navigation3.runtime)
    // Compile-time only use: the destination keys are @Serializable (kotlinx.serialization is allowed for navigation
    // keys and local JSON only, never for API payloads, which are protobuf).
    implementation(libs.kotlinx.serialization.json)
}
