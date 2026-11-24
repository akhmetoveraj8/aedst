plugins {
    alias(libs.plugins.kmp.library.convention)
}

// The pure domain of feature/tasks: entities, repository ports and use cases as common code (android + jvm targets).
// It depends on core/common only; data, presentation and the Metro wiring stay in the Android module next to it.
kotlin {
    android {
        namespace = "com.aedst.feature.tasks.domain"
    }

    sourceSets {
        commonMain.dependencies {
            api(project(":core:common"))
            implementation(libs.kotlinx.coroutines.core)
        }
        commonTest {
            // Fakes shared with feature/tasks unit tests (that module adds the same directory to its `test` set).
            kotlin.srcDir("src/commonTestFixtures/kotlin")
            dependencies {
                implementation(libs.kotlinx.coroutines.test)
            }
        }
    }
}
