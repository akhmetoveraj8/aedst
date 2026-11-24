plugins {
    alias(libs.plugins.kmp.library.convention)
    alias(libs.plugins.android.metro.convention)
}

kotlin {
    android {
        namespace = "com.aedst.core.common"
    }

    sourceSets {
        commonMain.dependencies {
            implementation(libs.kotlinx.coroutines.core)
        }
        commonTest.dependencies {
            implementation(libs.kotlinx.coroutines.test)
        }
        // The DI wiring (CommonModule, logger/dispatcher bindings, the hook multibindings, the WorkManager and
        // ViewModel factories every application graph needs) stays in androidMain: it uses Context, Log and WorkManager.
        androidMain.dependencies {
            implementation(libs.workmanager.runtime)
            // MetroViewModelFactory is the supertype of AedstViewModelFactory (the one factory both apps bind).
            api(libs.metrox.viewmodel)
        }
    }
}
