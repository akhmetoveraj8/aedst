plugins {
    alias(libs.plugins.kmp.library.convention)
}

// The pure domain of feature/notifications: entities, repository ports and use cases as common code (android + jvm targets).
// It depends on core/common only; data, presentation and the Hilt wiring stay in the Android module next to it.
kotlin {
    android {
        namespace = "com.aedst.feature.notifications.domain"
    }

    sourceSets {
        commonMain.dependencies {
            api(project(":core:common"))
            implementation(libs.kotlinx.coroutines.core)
        }
    }
}
