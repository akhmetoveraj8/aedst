plugins {
    alias(libs.plugins.kmp.library.convention)
    alias(libs.plugins.ksp)
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
        // Hilt is JVM-only: the DI wiring (CommonModule, LoggerModule, AppLifecycleHooksModule) stays in androidMain.
        // No Hilt Gradle plugin here: it only transforms @AndroidEntryPoint classes, and this module has none.
        androidMain.dependencies {
            implementation(libs.hilt.android)
            implementation(libs.javax.inject)
        }
    }
}

dependencies {
    add("kspAndroid", libs.hilt.compiler)
}
