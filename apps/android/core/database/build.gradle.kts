plugins {
    alias(libs.plugins.android.library.convention)
    alias(libs.plugins.android.hilt.convention)
    // Room 3 Gradle plugin (androidx.room3). Declares the schema directory as an input/output of the KSP task. A bare `ksp { arg("room.schemaLocation", ...) }`
    // is invisible to Gradle, so with the build cache on a cache hit would skip writing the schema JSON.
    alias(libs.plugins.room3)
}

room3 {
    schemaDirectory("$projectDir/schemas")
}

android {
    namespace = "com.aedst.core.database"

    // The exported schemas are the "from" side of MigrationTestHelper (AppDatabaseSchemaTest).
    sourceSets {
        getByName("test").assets.directories.add("$projectDir/schemas")
    }
}

dependencies {
    implementation(project(":core:common"))

    // The DAO/entity types are part of this module's API (core:outbox builds on them).
    api(libs.room.runtime)
    ksp(libs.room.compiler)

    testImplementation(project(":core:testing"))
    testImplementation(libs.robolectric)
    testImplementation(libs.androidx.test.core)
    testImplementation(libs.room.testing)
    // OutboxDaoTest runs on Robolectric (JUnit 4 runner, no Jupiter-native equivalent): see gradle/libs.versions.toml.
    testRuntimeOnly(libs.junit.vintage.engine)
}
