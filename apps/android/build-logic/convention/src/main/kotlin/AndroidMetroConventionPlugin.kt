import dev.zacsweers.metro.gradle.MetroPluginExtension
import org.gradle.api.Plugin
import org.gradle.api.Project
import org.gradle.kotlin.dsl.configure

/**
 * Wires Metro (DI) on any module that declares injected classes, bindings or graph contributions.
 *
 * Metro is a Kotlin compiler plugin: no KSP/kapt task, and the runtime artifact is added by the plugin itself. It
 * follows Kotlin visibility, so a type another module must see is public, except for `@Contributes*` classes: with
 * `generateContributionProviders` Metro exports only a generated provider that returns the bound type, which lets a
 * feature keep its repositories, ViewModels and workers `internal`.
 */
class AndroidMetroConventionPlugin : Plugin<Project> {
    override fun apply(target: Project) {
        with(target) {
            pluginManager.apply("dev.zacsweers.metro")

            extensions.configure<MetroPluginExtension> {
                generateContributionProviders.set(true)
            }
        }
    }
}
