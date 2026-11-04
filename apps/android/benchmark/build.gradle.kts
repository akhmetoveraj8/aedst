plugins {
    alias(libs.plugins.android.test)
    alias(libs.plugins.baseline.profile)
}

// Optional inputs of the benchmarks, forwarded to the instrumentation as arguments (see BenchmarkArguments.kt). They
// come from `-P...` or the environment, never from the repository: the signed-in journeys (task list scroll, signed-in
// baseline profile) are skipped, not failed, when no test account is supplied.
fun benchmarkInput(property: String, environment: String): String? = providers.gradleProperty(property)
    .orElse(providers.environmentVariable(environment))
    .orNull
    ?.takeIf(String::isNotBlank)

android {
    namespace = "com.aedst.benchmark"
    compileSdk = 37

    defaultConfig {
        minSdk = 28
        targetSdk = 36
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        // Macrobenchmark refuses to measure on an emulator / low battery unless told otherwise; emulator numbers are
        // meaningless, but CI uses an emulator to prove the benchmarks and the profile generator still run.
        // -Paedst.benchmark.suppressErrors=EMULATOR,LOW-BATTERY
        benchmarkInput("aedst.benchmark.suppressErrors", "AEDST_BENCHMARK_SUPPRESS_ERRORS")?.let {
            testInstrumentationRunnerArguments["androidx.benchmark.suppressErrors"] = it
        }
        benchmarkInput("aedst.benchmark.email", "AEDST_BENCHMARK_EMAIL")?.let {
            testInstrumentationRunnerArguments["aedst.benchmark.email"] = it
        }
        benchmarkInput("aedst.benchmark.password", "AEDST_BENCHMARK_PASSWORD")?.let {
            testInstrumentationRunnerArguments["aedst.benchmark.password"] = it
        }
        benchmarkInput("aedst.benchmark.submitLabel", "AEDST_BENCHMARK_SUBMIT_LABEL")?.let {
            testInstrumentationRunnerArguments["aedst.benchmark.submitLabel"] = it
        }
    }

    targetProjectPath = ":app"

    // Build types (`benchmarkRelease`, `nonMinifiedRelease`) are created by the androidx.baselineprofile plugin on
    // both this producer and `:app`; they are debug-signed copies of `release`, so no release keystore is needed.
    // A Gradle Managed Device (`testOptions.managedDevices`, then `baselineProfile { managedDevices += "<name>" }`)
    // is deliberately not configured: CI uses reactivecircus/android-emulator-runner like the instrumented job, and
    // local runs use a connected device.
}

baselineProfile {
    // Generate on a connected device/emulator (API 33+ needs no root; below that use a rootable AOSP image).
    useConnectedDevices = true
}

dependencies {
    implementation(libs.androidx.test.junit)
    implementation(libs.androidx.test.espresso)
    // Brings androidx.test.uiautomator (UiDevice/By/Until, 2.4.0) as a compile-scope dependency: MacrobenchmarkScope
    // exposes `device`, so no separate uiautomator catalog entry is needed.
    implementation(libs.androidx.benchmark.macro)
}
