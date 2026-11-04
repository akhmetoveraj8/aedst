import com.android.build.api.dsl.LibraryExtension
import org.gradle.api.JavaVersion
import org.gradle.api.Plugin
import org.gradle.api.Project
import org.gradle.kotlin.dsl.configure
import org.gradle.kotlin.dsl.dependencies

/**
 * Base convention for every Android library module (`core`, `feature`).
 * Mirrors the role of a Go module's shared build tags: one place that fixes
 * SDK levels, Java/Kotlin target and Java 8+ library desugaring so no module
 * configures these independently.
 */
class AndroidLibraryConventionPlugin : Plugin<Project> {
    override fun apply(target: Project) {
        with(target) {
            pluginManager.apply("com.android.library")
            pluginManager.apply("aedst.detekt")
            configureKover()

            extensions.configure<LibraryExtension> {
                compileSdk = ANDROID_COMPILE_SDK

                configureLint(lint)

                defaultConfig {
                    minSdk = ANDROID_MIN_SDK
                    testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
                    if (file("consumer-rules.pro").exists()) consumerProguardFiles("consumer-rules.pro")
                }

                testOptions {
                    unitTests.isIncludeAndroidResources = true
                }

                compileOptions {
                    sourceCompatibility = JavaVersion.VERSION_17
                    targetCompatibility = JavaVersion.VERSION_17
                    isCoreLibraryDesugaringEnabled = true
                }
            }

            tasks.withType(org.jetbrains.kotlin.gradle.tasks.KotlinCompile::class.java).configureEach {
                compilerOptions {
                    jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
                }
            }

            // JUnit 6 (Jupiter) runs every unit test. Robolectric / Compose-rule tests are JUnit 4: modules that have
            // them add `junit-vintage-engine` (testRuntimeOnly) so this same JUnit Platform task also runs those.
            tasks.withType(org.gradle.api.tasks.testing.Test::class.java).configureEach {
                useJUnitPlatform()
                // Gradle 9 fails a test task whose variant has generated (Hilt/KSP) test sources but no tests; many
                // modules legitimately have none yet.
                failOnNoDiscoveredTests.set(false)
            }

            dependencies {
                add("coreLibraryDesugaring", versionCatalog.findLibrary("desugar-jdk-libs").get())

                add("testImplementation", platform(versionCatalog.findLibrary("junit-bom").get()))
                add("testImplementation", versionCatalog.findLibrary("junit-jupiter").get())
                add("testRuntimeOnly", versionCatalog.findLibrary("junit-platform-launcher").get())
            }
        }
    }
}
