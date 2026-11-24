plugins {
    alias(libs.plugins.kmp.library.convention)
}

// The pure domain of feature/auth: entities, repository ports and use cases as common code (android + jvm targets).
// It depends on core/common only; data, presentation and the Metro wiring stay in the Android module next to it.
kotlin {
    android {
        namespace = "com.aedst.feature.auth.domain"
    }

    sourceSets {
        commonMain.dependencies {
            api(project(":core:common"))
            implementation(libs.kotlinx.coroutines.core)
        }
    }
}
