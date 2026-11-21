plugins {
    alias(libs.plugins.kmp.library.convention)
    alias(libs.plugins.ksp)
    // Room 3 Gradle plugin (androidx.room3). Declares the schema directory as an input/output of the KSP tasks. A bare
    // `ksp { arg("room.schemaLocation", ...) }` is invisible to Gradle, so with the build cache on a cache hit would
    // skip writing the schema JSON.
    alias(libs.plugins.room3)
}

room3 {
    schemaDirectory("$projectDir/schemas")
}

// Room 3 is multiplatform: the database, DAO and entities are common code; each target has its own KSP run (below) and
// its own driver. Android keeps the platform SQLite (`AndroidSQLiteDriver`, no native library in the APK); the JVM
// target uses the bundled driver in tests only. The Hilt module stays in androidMain.
kotlin {
    android {
        namespace = "com.aedst.core.database"
    }

    // Room's multiplatform constructor is an `expect object` whose `actual` the KSP processor generates. expect/actual
    // classes are still Beta in Kotlin; this is the only use, and Room offers no other way off Android.
    compilerOptions {
        freeCompilerArgs.add("-Xexpect-actual-classes")
    }

    sourceSets {
        commonMain.dependencies {
            implementation(project(":core:common"))
            // The DAO/entity types are part of this module's API (core:outbox builds on them).
            api(libs.room.runtime)
            implementation(libs.kotlinx.coroutines.core)
        }
        androidMain.dependencies {
            implementation(libs.hilt.android)
        }
        jvmTest.dependencies {
            implementation(libs.sqlite.bundled)
            implementation(libs.kotlinx.coroutines.test)
        }
        getByName("androidHostTest").dependencies {
            implementation(libs.robolectric)
            implementation(libs.androidx.test.core)
            implementation(libs.room.testing)
            // OutboxDaoTest runs on Robolectric (JUnit 4 runner, no Jupiter-native equivalent).
            implementation(libs.junit.vintage.engine)
        }
    }
}

dependencies {
    add("kspAndroid", libs.room.compiler)
    add("kspJvm", libs.room.compiler)
    add("kspAndroid", libs.hilt.compiler)
}

// The exported schemas are the "from" side of MigrationTestHelper (AppDatabaseSchemaTest reads them as test assets).
androidComponents {
    onVariants { variant ->
        variant.hostTests.values.forEach { it.sources.assets?.addStaticSourceDirectory("$projectDir/schemas") }
    }
}
