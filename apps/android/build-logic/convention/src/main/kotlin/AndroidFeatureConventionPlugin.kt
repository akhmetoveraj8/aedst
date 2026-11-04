import org.gradle.api.Plugin
import org.gradle.api.Project
import org.gradle.kotlin.dsl.dependencies

/**
 * Applied by every `feature` module. Composes the android-library, compose
 * and hilt conventions, and adds the modules every feature needs regardless
 * of its own domain (navigation contracts, common primitives, DI, coroutines).
 * This is the Android analog of a server module's standard layer imports.
 */
class AndroidFeatureConventionPlugin : Plugin<Project> {
    override fun apply(target: Project) {
        with(target) {
            pluginManager.apply("aedst.android.library")
            pluginManager.apply("aedst.android.compose")
            pluginManager.apply("aedst.android.hilt")

            dependencies {
                add("implementation", project(":core:common"))
                add("implementation", project(":core:ui"))
                add("implementation", project(":core:navigation"))
                // Navigation 3 runtime (NavKey, EntryProviderScope): the contract each feature registers entries on.
                // The NavDisplay UI and the entry decorators (ViewModel scoping) live in app/, not in features.
                add("implementation", versionCatalog.findLibrary("navigation3-runtime").get())
                // hiltViewModel() (+ the assisted-injection overload for ViewModels that take a navigation key).
                add("implementation", versionCatalog.findLibrary("hilt-lifecycle-viewmodel-compose").get())
                add("implementation", versionCatalog.findLibrary("kotlinx-coroutines-android").get())

                add("testImplementation", project(":core:testing"))
                add("testImplementation", versionCatalog.findLibrary("mockk").get())
                add("testImplementation", versionCatalog.findLibrary("turbine").get())
                add("testImplementation", versionCatalog.findLibrary("kotlinx-coroutines-test").get())
            }
        }
    }
}
