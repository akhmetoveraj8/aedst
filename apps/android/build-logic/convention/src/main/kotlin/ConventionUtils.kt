import org.gradle.api.Project
import org.gradle.api.artifacts.VersionCatalog
import org.gradle.api.artifacts.VersionCatalogsExtension
import org.gradle.kotlin.dsl.getByType

/** Accessor for the `libs` version catalog from inside a precompiled convention plugin. */
val Project.versionCatalog: VersionCatalog
    get() = extensions.getByType<VersionCatalogsExtension>().named("libs")

const val ANDROID_COMPILE_SDK = 37
const val ANDROID_TARGET_SDK = 36
const val ANDROID_MIN_SDK = 26
