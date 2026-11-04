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

include(":feature:auth")
include(":feature:tasks")
include(":feature:search")
include(":feature:notifications")
include(":feature:media")
include(":feature:admin")

include(":benchmark")
