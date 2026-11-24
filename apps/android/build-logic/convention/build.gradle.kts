plugins {
    `kotlin-dsl`
}

group = "com.aedst.buildlogic"

java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(21))
    }
}

dependencies {
    compileOnly(libs.android.gradlePlugin)
    compileOnly(libs.kotlin.gradlePlugin)
    compileOnly(libs.ksp.gradlePlugin)
    compileOnly(libs.metro.gradlePlugin)
    compileOnly(libs.detekt.gradlePlugin)
    compileOnly(libs.ktlint.gradlePlugin)
    compileOnly(libs.kover.gradlePlugin)
    compileOnly(libs.compose.compiler.gradlePlugin)
}

gradlePlugin {
    plugins {
        register("androidApplication") {
            id = "aedst.android.application"
            implementationClass = "AndroidApplicationConventionPlugin"
        }
        register("androidLibrary") {
            id = "aedst.android.library"
            implementationClass = "AndroidLibraryConventionPlugin"
        }
        register("androidFeature") {
            id = "aedst.android.feature"
            implementationClass = "AndroidFeatureConventionPlugin"
        }
        register("androidCompose") {
            id = "aedst.android.compose"
            implementationClass = "AndroidComposeConventionPlugin"
        }
        register("androidMetro") {
            id = "aedst.android.metro"
            implementationClass = "AndroidMetroConventionPlugin"
        }
        register("kmpLibrary") {
            id = "aedst.kmp.library"
            implementationClass = "KmpLibraryConventionPlugin"
        }
        register("jvmLibrary") {
            id = "aedst.jvm.library"
            implementationClass = "JvmLibraryConventionPlugin"
        }
        register("detekt") {
            id = "aedst.detekt"
            implementationClass = "DetektConventionPlugin"
        }
    }
}
