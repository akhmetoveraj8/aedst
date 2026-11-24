pluginManagement {
    includeBuild("build-logic")
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "aedst-android"

include(":app")
include(":app-tv")

include(":core:common")
include(":core:ui")
include(":core:ui-tv")
include(":core:network")
include(":core:capabilities")
include(":core:database")
include(":core:datastore")
include(":core:security")
include(":core:outbox")
include(":core:analytics")
include(":core:navigation")
include(":core:media")
include(":core:testing")

// A feature is an Android module (data, presentation, navigation, Metro) plus, when it has domain logic, a Kotlin
// Multiplatform `:feature:<name>:domain` module (commonMain; docs/content/android/kmp.md).
include(":feature:auth")
include(":feature:auth:domain")
include(":feature:tasks")
include(":feature:tasks:domain")
include(":feature:search")
include(":feature:search:domain")
include(":feature:notifications")
include(":feature:notifications:domain")
include(":feature:media")
include(":feature:admin")
include(":feature:admin:domain")

include(":benchmark")
