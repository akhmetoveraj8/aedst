plugins {
    alias(libs.plugins.android.library.convention)
    alias(libs.plugins.android.hilt.convention)
}

android {
    namespace = "com.aedst.core.outbox"
}

dependencies {
    implementation(project(":core:common"))
    api(project(":core:database"))

    implementation(libs.workmanager.runtime)
    implementation(libs.hilt.work)
    ksp(libs.hilt.work.compiler)
    implementation(libs.kotlinx.coroutines.android)

    testImplementation(project(":core:testing"))
    testImplementation(libs.robolectric)
    testImplementation(libs.androidx.test.core)
    testImplementation(libs.work.testing)
    testImplementation(libs.kotlinx.serialization.json)
    // OutboxSyncWorkerTest runs on Robolectric (JUnit 4 runner, no Jupiter-native equivalent): see libs.versions.toml.
    // testImplementation (not runtimeOnly): the vintage engine brings junit:junit 4, whose org.junit API these tests compile against.
    testImplementation(libs.junit.vintage.engine)
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
