package com.aedst.benchmark

import androidx.benchmark.macro.BaselineProfileMode
import androidx.benchmark.macro.CompilationMode
import androidx.benchmark.macro.FrameTimingMetric
import androidx.benchmark.macro.junit4.MacrobenchmarkRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Frame timing (`frameDurationCpuMs`, `frameOverrunMs`) while flinging the signed-in task list, once with
 * [CompilationMode.None] and once with the baseline profile (`Partial`, when the APK has one).
 *
 * The task list is behind sign-in, so this is opt-in: it runs only when a test account is passed
 * (`-Paedst.benchmark.email` / `-Paedst.benchmark.password`, optionally `-Paedst.benchmark.submitLabel` and, for a
 * non-default API host, `-Paedst.baseUrl` when building the app) and is skipped with an explicit message otherwise,
 * so it never breaks a run without a backend. The account needs more tasks than fit on one screen.
 */
@RunWith(AndroidJUnit4::class)
class TaskListScrollBenchmark {

    @get:Rule
    val benchmarkRule = MacrobenchmarkRule()

    private var credentials: BenchmarkCredentials? = null

    @Before
    fun requireTestAccount() {
        credentials = BenchmarkCredentials.fromArguments()
        assumeTrue(SIGNED_IN_SKIP_MESSAGE, credentials != null)
    }

    @Test
    fun scrollTaskListNoCompilation() = scrollTaskList(CompilationMode.None())

    @Test
    fun scrollTaskListWithProfile() =
        scrollTaskList(CompilationMode.Partial(baselineProfileMode = BaselineProfileMode.UseIfAvailable))

    private fun scrollTaskList(compilationMode: CompilationMode) = benchmarkRule.measureRepeated(
        packageName = TARGET_PACKAGE,
        metrics = listOf(FrameTimingMetric()),
        iterations = ITERATIONS,
        // No startup mode: the process lives across iterations, so only the scrolling is measured, not the launch.
        compilationMode = compilationMode,
        setupBlock = {
            pressHome()
            startActivityAndWait()
            signInIfNeeded(checkNotNull(credentials))
        },
    ) {
        flingTaskList()
    }

    private companion object {
        const val ITERATIONS = 10
    }
}
