import kotlinx.kover.gradle.plugin.dsl.KoverProjectExtension
import org.gradle.api.Project
import org.gradle.kotlin.dsl.configure
import java.util.Properties

/**
 * Kover (JVM unit-test line coverage) with a per-module floor. The floors live in `kover-thresholds.properties` at the
 * project root (`core/common=60`), so raising or lowering one is a visible, reviewed diff. A module without an entry
 * has no floor (reported only); `koverVerify` in android-ci fails a module that drops below its floor.
 *
 * Generated and framework glue is excluded: Metro output, Room `_Impl`, Compose singletons, R/BuildConfig.
 */
fun Project.configureKover() {
    pluginManager.apply("org.jetbrains.kotlinx.kover")

    val thresholds = Properties().apply {
        val file = rootProject.file("kover-thresholds.properties")
        if (file.exists()) file.inputStream().use(::load)
    }
    // Keys are module directories (`core/common`): a leading `:` would be read as the key/value separator by Properties.
    val floor = thresholds.getProperty(path.removePrefix(":").replace(':', '/'))?.trim()?.toIntOrNull()

    extensions.configure<KoverProjectExtension> {
        reports {
            filters {
                excludes {
                    classes(
                        "*.R",
                        "*.R$*",
                        "*.BuildConfig",
                        "*\$\$Metro*",
                        "metro.hints.*",
                        "*_Impl",
                        "*_Impl$*",
                        "*ComposableSingletons*",
                        "*.databinding.*",
                    )
                    // Generated ConnectRPC/protobuf stubs (core/network src/main/kotlin-gen).
                    packages("com.aedst.*.v1")
                }
            }
            if (floor != null) {
                verify {
                    rule("Minimum line coverage ($path)") {
                        minBound(floor)
                    }
                }
            }
        }
    }
}
