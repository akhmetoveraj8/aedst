plugins {
    alias(libs.plugins.android.library.convention)
    alias(libs.plugins.android.hilt.convention)
    alias(libs.plugins.protobuf)
}

android {
    namespace = "com.aedst.core.datastore"
}

protobuf {
    protoc {
        artifact = "com.google.protobuf:protoc:${libs.versions.protobuf.javalite.get()}"
    }
    generateProtoTasks {
        all().forEach { task ->
            task.builtins {
                create("java") {
                    option("lite")
                }
            }
        }
    }
}

dependencies {
    implementation(project(":core:common"))

    // DataStore<UserPrefs> and the generated UserPrefs type are this module's API (core/analytics, feature/notifications).
    api(libs.datastore.core)
    api(libs.protobuf.javalite)

    testImplementation(libs.kotlinx.coroutines.test)
}
