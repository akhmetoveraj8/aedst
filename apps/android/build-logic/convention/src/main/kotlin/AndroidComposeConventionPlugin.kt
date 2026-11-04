import com.android.build.api.dsl.CommonExtension
import org.gradle.api.Plugin
import org.gradle.api.Project
import org.gradle.kotlin.dsl.configure
import org.gradle.kotlin.dsl.dependencies
import org.jetbrains.kotlin.compose.compiler.gradle.ComposeCompilerGradlePluginExtension

/** Wires the Compose compiler + BOM-managed Compose/Material3 artifacts on any android module. */
class AndroidComposeConventionPlugin : Plugin<Project> {
    override fun apply(target: Project) {
        with(target) {
            pluginManager.apply("org.jetbrains.kotlin.plugin.compose")

            extensions.configure<ComposeCompilerGradlePluginExtension> {
                // java.time.Instant and android.net.Uri are immutable but come from non-Compose libraries.
                stabilityConfigurationFiles.add(rootProject.layout.projectDirectory.file("compose_compiler_config.conf"))
            }

            // Opt-in stability/skippability reports: `./gradlew assembleRelease -Paedst.composeReports`, then read
            // build/compose_reports/*-classes.txt and *-composables.txt to find unstable params causing recomposition.
            if (providers.gradleProperty("aedst.composeReports").isPresent) {
                extensions.configure<ComposeCompilerGradlePluginExtension> {
                    reportsDestination.set(layout.buildDirectory.dir("compose_reports"))
                    metricsDestination.set(layout.buildDirectory.dir("compose_metrics"))
                }
            }

            extensions.configure(CommonExtension::class.java) {
                buildFeatures.compose = true
            }

            dependencies {
                // BOM pins every androidx.compose.* artifact to one consistent set.
                val bom = platform(versionCatalog.findLibrary("compose-bom").get())
                add("implementation", bom)
                add("debugImplementation", bom)
                add("androidTestImplementation", bom)
                add("implementation", versionCatalog.findLibrary("compose-ui").get())
                add("implementation", versionCatalog.findLibrary("compose-ui-graphics").get())
                add("implementation", versionCatalog.findLibrary("compose-ui-tooling-preview").get())
                add("implementation", versionCatalog.findLibrary("compose-material3").get())
                add("implementation", versionCatalog.findLibrary("compose-lifecycle-runtime").get())
                add("implementation", versionCatalog.findLibrary("compose-lifecycle-viewmodel").get())
                add("debugImplementation", versionCatalog.findLibrary("compose-ui-tooling").get())
                add("androidTestImplementation", versionCatalog.findLibrary("compose-ui-test-junit4").get())
                add("debugImplementation", versionCatalog.findLibrary("compose-ui-test-manifest").get())

                // JVM UI tests (Robolectric + createComposeRule, JUnit 4: see libs.versions.toml) + instrumented UI
                // tests with Accessibility Test Framework checks.
                add("testImplementation", versionCatalog.findLibrary("compose-ui-test-junit4").get())
                add("testImplementation", versionCatalog.findLibrary("robolectric").get())
                add("testImplementation", versionCatalog.findLibrary("androidx-test-core").get())
                add("androidTestImplementation", versionCatalog.findLibrary("compose-ui-test-accessibility").get())
                add("androidTestImplementation", versionCatalog.findLibrary("androidx-test-junit").get())
                add("androidTestImplementation", versionCatalog.findLibrary("androidx-test-runner").get())
            }
        }
    }
}
