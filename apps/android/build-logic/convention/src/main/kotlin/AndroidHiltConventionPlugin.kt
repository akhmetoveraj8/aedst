import org.gradle.api.Plugin
import org.gradle.api.Project
import org.gradle.kotlin.dsl.dependencies

/** Wires Hilt (DI) + KSP on any module that declares Hilt modules/entry points. */
class AndroidHiltConventionPlugin : Plugin<Project> {
    override fun apply(target: Project) {
        with(target) {
            pluginManager.apply("com.google.devtools.ksp")
            pluginManager.apply("com.google.dagger.hilt.android")

            dependencies {
                add("implementation", versionCatalog.findLibrary("hilt-android").get())
                add("ksp", versionCatalog.findLibrary("hilt-compiler").get())
            }
        }
    }
}
