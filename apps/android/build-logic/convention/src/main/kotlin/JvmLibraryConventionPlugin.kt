import org.gradle.api.JavaVersion
import org.gradle.api.Plugin
import org.gradle.api.Project
import org.gradle.api.plugins.JavaPluginExtension
import org.gradle.api.tasks.testing.Test
import org.gradle.kotlin.dsl.configure
import org.gradle.kotlin.dsl.dependencies
import org.gradle.kotlin.dsl.withType

/**
 * For pure-Kotlin/JVM modules with no Android dependency (no module uses it yet, kept for parity with server's
 * `internal/shared`).
 *
 * Tests run on JUnit 6 (Jupiter): `junit-bom` aligns every `org.junit.*` artifact, `junit-jupiter` brings the API,
 * params and engine, and `junit-platform-launcher` must be on the runtime classpath for Gradle's `useJUnitPlatform()`.
 * Android library modules get the same wiring in `aedst.android.library`; only Robolectric/Compose-rule tests there
 * stay JUnit 4 (through the vintage engine), see that plugin and docs/content/library-first.md.
 */
class JvmLibraryConventionPlugin : Plugin<Project> {
    override fun apply(target: Project) {
        with(target) {
            pluginManager.apply("org.jetbrains.kotlin.jvm")
            pluginManager.apply("aedst.detekt")

            extensions.configure<JavaPluginExtension> {
                sourceCompatibility = JavaVersion.VERSION_17
                targetCompatibility = JavaVersion.VERSION_17
            }

            dependencies {
                add("testImplementation", platform(versionCatalog.findLibrary("junit-bom").get()))
                add("testImplementation", versionCatalog.findLibrary("junit-jupiter").get())
                add("testRuntimeOnly", versionCatalog.findLibrary("junit-platform-launcher").get())
            }

            tasks.withType<Test>().configureEach {
                useJUnitPlatform()
            }
        }
    }
}
