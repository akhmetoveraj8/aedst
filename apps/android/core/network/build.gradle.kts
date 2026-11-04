plugins {
    alias(libs.plugins.android.library.convention)
    alias(libs.plugins.android.hilt.convention)
}

// Release TLS pins: comma-separated `sha256/<base64 SPKI hash>` values (live key + at least one backup), passed as
// `-Paedst.certPins=...` (CI secret / ~/.gradle/gradle.properties). Never committed: they are per-environment.
val certPins = providers.gradleProperty("aedst.certPins").orElse("")
val allowUnpinnedRelease = providers.gradleProperty("aedst.allowUnpinnedRelease").map(String::toBoolean).orElse(false)
// Release API host override (`-Paedst.baseUrl=https://staging.example/` or env AEDST_BASE_URL), mainly so the
// benchmark build types (release copies) can talk to a staging backend with a test account. Must be https and end
// with a slash.
val releaseBaseUrl = providers.gradleProperty("aedst.baseUrl")
    .orElse(providers.environmentVariable("AEDST_BASE_URL"))
    .orElse("https://api.aedst.example/")
// Debug API host (`-Paedst.debugBaseUrl=https://staging.example/` or env AEDST_DEBUG_BASE_URL). The default is the
// emulator's loopback to the host machine, where `task dev` serves the API on :8080 (plain http is allowed only for
// 10.0.2.2/localhost by the debug-only network security config). Not a made-up remote host: a debug build used to point
// at a hostname that does not exist. Must end with a slash.
val debugBaseUrl = providers.gradleProperty("aedst.debugBaseUrl")
    .orElse(providers.environmentVariable("AEDST_DEBUG_BASE_URL"))
    .orElse("http://10.0.2.2:8080/")
val clientVersion = providers.gradleProperty("aedst.versionName").orElse("1.0.0")

android {
    namespace = "com.aedst.core.network"

    buildFeatures {
        buildConfig = true
    }

    defaultConfig {
        buildConfigField("String", "CLIENT_VERSION", "\"${clientVersion.get()}\"")
    }

    buildTypes {
        debug {
            buildConfigField("String", "BASE_URL", "\"${debugBaseUrl.get()}\"")
            buildConfigField("String", "CERT_PINS", "\"\"")
        }
        release {
            buildConfigField("String", "BASE_URL", "\"${releaseBaseUrl.get()}\"")
            buildConfigField("String", "CERT_PINS", "\"${certPins.get()}\"")
        }
    }

    // `buf generate` (see ../../buf.gen.yaml, run via `make generate` from
    // apps/android/) writes the ConnectRPC/Protobuf Kotlin gencode here —
    // the Kotlin-side equivalent of apps/apple's Generated/ sourceSet.
    // Nothing under kotlin-gen is committed (see .gitignore); run `make
    // generate` after cloning, before opening the project.
    sourceSets {
        // Java (protobuf messages) and Kotlin (DSL + connect client) gencode share one
        // directory; each compiler only takes its own file type.
        getByName("main").java.directories.add("src/main/kotlin-gen")
        getByName("main").kotlin.directories.add("src/main/kotlin-gen")
    }
}

dependencies {
    implementation(project(":core:common"))
    implementation(project(":core:security"))

    // ConnectRPC client + generated message/service types (aedst.*.v1.*)
    // consumed by feature modules — see docs/content/library-first.md's
    // Android table. Retrofit/OkHttp-as-REST-client is not used for these
    // calls; OkHttp remains only as connect-kotlin's HTTP engine.
    api(libs.connect.kotlin.core)
    api(libs.connect.kotlin.google.javalite.ext)
    api(libs.protobuf.kotlin.lite)
    implementation(libs.connect.kotlin.okhttp)
    implementation(libs.okhttp.core)
    implementation(libs.okhttp.logging.interceptor)
    implementation(libs.kotlinx.coroutines.core)

    testImplementation(project(":core:testing"))
    testImplementation(libs.okhttp.mockwebserver)
    testImplementation(libs.kotlinx.coroutines.test)
}

// Contract test input (ProtoContractTest): the server's proto descriptors as JSON, written by `make descriptors`
// (`buf build`) into this build dir. protobuf-javalite carries no descriptors, so the test reads the JSON instead of
// mixing protobuf-java into the test classpath. AEDST_REQUIRE_CONTRACT=1 (CI) turns a missing file into a failure.
val contractDescriptors = layout.buildDirectory.file("contract/descriptors.json")
tasks.withType<Test>().configureEach {
    systemProperty("aedst.descriptors", contractDescriptors.get().asFile.absolutePath)
    inputs.files(contractDescriptors).withPropertyName("contractDescriptors").optional()
    inputs.property("requireContract", providers.environmentVariable("AEDST_REQUIRE_CONTRACT").orElse(""))
}

// A release build without TLS pinning is a security regression, so refuse to produce one by accident. `app/` wires
// this into its `preReleaseBuild`. Opt out explicitly with -Paedst.allowUnpinnedRelease=true (e.g. a staging flavour).
tasks.register("verifyReleaseCertPins") {
    group = "verification"
    description = "Fails if a release build would ship without TLS certificate pins."
    val pins = certPins
    val allowUnpinned = allowUnpinnedRelease
    doLast {
        if (pins.get().isBlank() && !allowUnpinned.get()) {
            throw GradleException(
                "Release build has no TLS pins. Pass -Paedst.certPins=sha256/<live>,sha256/<backup> " +
                    "(or -Paedst.allowUnpinnedRelease=true for a non-production build).",
            )
        }
    }
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
