import dev.detekt.gradle.Detekt
import dev.detekt.gradle.extensions.DetektExtension
import org.gradle.api.Plugin
import org.gradle.api.Project
import org.gradle.kotlin.dsl.configure
import org.gradle.kotlin.dsl.dependencies
import org.jlleitschuh.gradle.ktlint.KtlintExtension

/** Applied transitively by the android-library/application/jvm conventions — never applied on its own. */
class DetektConventionPlugin : Plugin<Project> {
    override fun apply(target: Project) {
        with(target) {
            // detekt 2.0.0-alpha.6 (group dev.detekt): documented pre-release exception, see libs.versions.toml.
            pluginManager.apply("dev.detekt")
            pluginManager.apply("org.jlleitschuh.gradle.ktlint")

            extensions.configure<DetektExtension> {
                buildUponDefaultConfig.set(true)
                config.setFrom(rootProject.file("detekt.yml"))
                autoCorrect.set(false)
            }

            // Compose rules (mrmans0n/compose-rules, built against dev.detekt 2.0.0-alpha.6). Harmless on modules
            // without Compose: the rules only fire on @Composable functions.
            dependencies {
                add("detektPlugins", versionCatalog.findLibrary("compose-rules-detekt").get())
            }

            // core/network registers src/main/kotlin-gen (buf-generated
            // ConnectRPC/Protobuf stubs, see its build.gradle.kts) as an extra
            // `main` Kotlin source dir. Neither linter should format-check or
            // analyze generated code.
            // No jvmTarget override: detekt 2 takes it from the Kotlin compilation's compilerOptions (JVM 17).
            tasks.withType(Detekt::class.java).configureEach {
                exclude("**/kotlin-gen/**")
                // A relative glob never matches when the source root itself is kotlin-gen (type-resolved tasks).
                exclude { it.file.invariantSeparatorsPath.contains("/kotlin-gen/") }
            }
            extensions.configure<KtlintExtension> {
                filter {
                    exclude { entry -> entry.file.path.contains("kotlin-gen") }
                }
            }

            // The plain `detekt` task has no type resolution, so rules such as SuspendFunSwallowedCancellation and
            // InjectDispatcher would be silently skipped. `detektDebug` runs the same rules with the compiled debug
            // classpath; making `detekt` depend on it means `task android:lint` (./gradlew detekt) always runs the
            // type-resolved pass. Library modules only (the plugin task exists once AGP has registered the variant).
            tasks.matching { it.name == "detekt" }.configureEach {
                dependsOn(tasks.matching { it.name == "detektDebug" })
            }
        }
    }
}
