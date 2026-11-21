import com.android.build.api.dsl.KotlinMultiplatformAndroidLibraryTarget
import org.gradle.api.Plugin
import org.gradle.api.Project
import org.gradle.api.plugins.ExtensionAware
import org.gradle.api.tasks.testing.Test
import org.gradle.kotlin.dsl.configure
import org.gradle.kotlin.dsl.dependencies
import org.gradle.kotlin.dsl.withType
import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import org.jetbrains.kotlin.gradle.dsl.KotlinMultiplatformExtension
import org.jetbrains.kotlin.gradle.tasks.KotlinJvmCompile

/**
 * Kotlin Multiplatform library: shared code in `commonMain`, compiled for Android (`androidMain`, through AGP's
 * `com.android.kotlin.multiplatform.library`, the only Android plugin AGP 9 accepts next to `kotlin-multiplatform`)
 * and for the plain JVM (`jvmMain`: tests without the Android SDK). Used by `core/common` and every
 * `feature/<name>/domain`.
 *
 * There is NO iOS target on purpose (owner decision 2026-11-21: Apple stays native SwiftUI). A team that wants one adds
 * the targets at the marked line; `commonMain` already compiles as common code, so nothing else moves. See
 * docs/content/android/kmp.md.
 *
 * The module sets `kotlin { android { namespace = "..." } }` itself. Tests: `commonTest` with `kotlin.test`, run by
 * `jvmTest` and `testAndroidHostTest` on the JUnit Platform (same JUnit 6 engine as `aedst.android.library`).
 */
class KmpLibraryConventionPlugin : Plugin<Project> {
    override fun apply(target: Project) {
        with(target) {
            pluginManager.apply("org.jetbrains.kotlin.multiplatform")
            pluginManager.apply("com.android.kotlin.multiplatform.library")
            pluginManager.apply("aedst.detekt")
            configureKover()

            extensions.configure<KotlinMultiplatformExtension> {
                // Every declaration in a shared module states its visibility: the public surface is deliberate.
                explicitApi()

                jvm()
                // iOS (not enabled in this template): iosArm64(); iosSimulatorArm64()

                (this as ExtensionAware).extensions.configure<KotlinMultiplatformAndroidLibraryTarget> {
                    compileSdk = ANDROID_COMPILE_SDK
                    minSdk = ANDROID_MIN_SDK
                    configureLint(lint)
                    withHostTest {}
                }

                // commonMain -> { androidMain, jvmMain } (and the apple/native groups once a target is added).
                applyDefaultHierarchyTemplate()

                sourceSets.named("commonTest") {
                    dependencies {
                        implementation(kotlin("test"))
                    }
                }
            }

            tasks.withType<KotlinJvmCompile>().configureEach {
                compilerOptions {
                    jvmTarget.set(JvmTarget.JVM_17)
                }
            }

            // The plain `detekt` task has no source set in a multiplatform module (it would pass with NO-SOURCE). Point
            // it at the type-resolved per-target tasks, so `./gradlew detekt` analyses commonMain plus each target's
            // own source set, as `detektDebug` does for Android library modules.
            tasks.matching { it.name == "detekt" }.configureEach {
                dependsOn(tasks.matching { it.name == "detektMainJvm" || it.name == "detektMainAndroid" })
            }

            // CI, the Taskfile and the Makefile call the Android-wide task names (`./gradlew testDebugUnitTest
            // koverVerifyDebug`). A multiplatform module has no `debug` variant, so it answers to the same names:
            // otherwise those commands would silently skip the shared code. There is no `lintDebug` counterpart: AGP
            // registers no Android Lint task for the main source set of a multiplatform library; the application
            // modules lint their dependencies (`checkDependencies = true`).
            mapOf(
                "testDebugUnitTest" to "allTests",
                "koverVerifyDebug" to "koverVerify",
            ).forEach { (androidName, multiplatformName) ->
                tasks.register(androidName) {
                    group = "verification"
                    description = "Runs $multiplatformName (the multiplatform counterpart of $androidName)."
                    dependsOn(tasks.matching { it.name == multiplatformName })
                }
            }

            tasks.withType<Test>().configureEach {
                useJUnitPlatform()
                failOnNoDiscoveredTests.set(false)
            }

            dependencies {
                for (testSourceSet in listOf("jvmTest", "androidHostTest")) {
                    add("${testSourceSet}Implementation", platform(versionCatalog.findLibrary("junit-bom").get()))
                    add("${testSourceSet}RuntimeOnly", versionCatalog.findLibrary("junit-jupiter").get())
                    add("${testSourceSet}RuntimeOnly", versionCatalog.findLibrary("junit-platform-launcher").get())
                }
            }
        }
    }
}
