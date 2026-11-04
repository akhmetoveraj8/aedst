plugins {
    alias(libs.plugins.android.library.convention)
    alias(libs.plugins.android.compose.convention)
    alias(libs.plugins.roborazzi)
}

android {
    namespace = "com.aedst.core.ui"

    // ComponentCatalog (every public component with representative state) is shared by the JVM screenshot/semantics
    // tests and the instrumented Accessibility Test Framework suite, so a new component is covered by all three.
    sourceSets {
        getByName("test").kotlin.directories.add("src/sharedTest/kotlin")
        getByName("androidTest").kotlin.directories.add("src/sharedTest/kotlin")
    }
}

// Roborazzi golden images (committed). `recordRoborazziDebug` writes them, `verifyRoborazziDebug` fails on a pixel
// difference. Must match ComponentScreenshotTest.SNAPSHOT_DIR. A plain `testDebugUnitTest` captures nothing.
roborazzi {
    outputDir.set(file("src/test/snapshots"))
}

// Hardware pixel-copy rendering makes Robolectric native-graphics screenshots match a real device more closely
// (Roborazzi docs, "gradle.properties Options and Recommendations").
tasks.withType<Test>().configureEach {
    systemProperty("robolectric.pixelCopyRenderMode", "hardware")
}

dependencies {
    // AedstError → localized message mapping lives next to the strings (ErrorMessages.kt).
    implementation(project(":core:common"))
    implementation(libs.androidx.core.ktx) // androidx.core.net.toUri
    implementation(libs.compose.material.icons.extended)
    // currentWindowAdaptiveInfoV2 (window size class + fold posture) for core.ui.adaptive; BOM-managed (1.3.0).
    implementation(libs.compose.material3.adaptive)

    testImplementation(project(":core:testing"))
    testImplementation(libs.roborazzi)
    testImplementation(libs.roborazzi.compose)
    // Component tests use Robolectric + createComposeRule + Roborazzi (JUnit 4 runner/rules, no Jupiter-native
    // equivalent): the vintage engine runs them next to the Jupiter tests, see gradle/libs.versions.toml.
    testRuntimeOnly(libs.junit.vintage.engine)
}
