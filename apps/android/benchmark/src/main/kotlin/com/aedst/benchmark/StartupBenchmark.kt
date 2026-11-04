package com.aedst.benchmark

import androidx.benchmark.macro.BaselineProfileMode
import androidx.benchmark.macro.CompilationMode
import androidx.benchmark.macro.StartupMode
import androidx.benchmark.macro.StartupTimingMetric
import androidx.benchmark.macro.junit4.MacrobenchmarkRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Cold app startup, signed out (lands on the login screen) and, with a test account, signed in (lands on the task
 * list). Each scenario runs with [CompilationMode.None] (everything JIT-compiled: the worst case, e.g. right after an
 * install from the APK) and [CompilationMode.Partial] with the baseline profile when the APK contains one (what a
 * Play install looks like). The gap between the two is the profile's win; run it before/after a profile change.
 *
 * `Partial` uses [BaselineProfileMode.UseIfAvailable] so the benchmark also runs before a profile has been generated
 * and committed (`BaselineProfileMode.Require` would fail instead). Needs a device/emulator, see
 * apps/android/README.md.
 */
@RunWith(AndroidJUnit4::class)
class StartupBenchmark {

    @get:Rule
    val benchmarkRule = MacrobenchmarkRule()

    @Test
    fun startupColdSignedOutNoCompilation() = startupSignedOut(CompilationMode.None())

    @Test
    fun startupColdSignedOutWithProfile() = startupSignedOut(WITH_PROFILE)

    @Test
    fun startupColdSignedInNoCompilation() = startupSignedIn(CompilationMode.None())

    @Test
    fun startupColdSignedInWithProfile() = startupSignedIn(WITH_PROFILE)

    private fun startupSignedOut(compilationMode: CompilationMode) = benchmarkRule.measureRepeated(
        packageName = TARGET_PACKAGE,
        metrics = listOf(StartupTimingMetric()),
        iterations = ITERATIONS,
        startupMode = StartupMode.COLD,
        compilationMode = compilationMode,
        // pm clear = no stored session, so every iteration starts on the login screen.
        setupBlock = {
            device.executeShellCommand("pm clear $TARGET_PACKAGE")
            pressHome()
        },
    ) {
        startActivityAndWait()
    }

    private fun startupSignedIn(compilationMode: CompilationMode) {
        val credentials = BenchmarkCredentials.fromArguments()
        assumeTrue(SIGNED_IN_SKIP_MESSAGE, credentials != null)
        var sessionReady = false
        benchmarkRule.measureRepeated(
            packageName = TARGET_PACKAGE,
            metrics = listOf(StartupTimingMetric()),
            iterations = ITERATIONS,
            startupMode = StartupMode.COLD,
            compilationMode = compilationMode,
            setupBlock = {
                // The first iteration signs in once; the session then persists across the cold starts that follow.
                if (!sessionReady) {
                    startActivityAndWait()
                    signInIfNeeded(checkNotNull(credentials))
                    persistSessionAndKill()
                    sessionReady = true
                }
                pressHome()
            },
        ) {
            startActivityAndWait()
        }
    }

    private companion object {
        const val ITERATIONS = 5
        val WITH_PROFILE = CompilationMode.Partial(baselineProfileMode = BaselineProfileMode.UseIfAvailable)
    }
}
