plugins {
    alias(libs.plugins.android.library.convention)
    alias(libs.plugins.android.hilt.convention)
}

android {
    namespace = "com.aedst.core.capabilities"
}

dependencies {
    implementation(project(":core:common"))
    // Generated CapabilitiesService client + the ClientUpgradeGate the forced-upgrade screen listens to.
    implementation(project(":core:network"))
    // Last-known capabilities live in the UserPrefs DataStore (UserPrefs.capabilities_snapshot).
    implementation(project(":core:datastore"))
    implementation(libs.kotlinx.coroutines.core)

    testImplementation(project(":core:testing"))
}

// Cross-platform behaviour fixtures (docs/contract/behavior) are the single source: put the directory itself on the
// unit-test classpath instead of copying the files (see core/testing's BehaviorFixture).
android {
    sourceSets {
        getByName("test").resources.directories.add(
            rootProject.layout.projectDirectory.dir("../../docs/contract/behavior").asFile.absolutePath,
        )
    }
}
