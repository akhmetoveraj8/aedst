package com.aedst.benchmark

import androidx.benchmark.macro.junit4.BaselineProfileRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Records the critical user journeys that the app's baseline (and startup) profile is built from. Run with
 * `./gradlew :app:generateBaselineProfile` (see apps/android/README.md); the output lands in
 * `app/src/release/generated/baselineProfiles/` (`saveInSrc = true` in app/build.gradle.kts) and is committed.
 *
 * Journeys covered:
 * - cold start to the first frame (also written to the startup profile, which drives dex layout optimization);
 * - the signed-out login screen: the app is reset with `pm clear` so every iteration really starts signed out;
 * - signed in, only when a test account is supplied (`-Paedst.benchmark.email|password`): sign-in and a fling through
 *   the task list.
 *
 * Not covered without further work: creating/completing a task, task detail, search, notifications and the admin
 * screens. They need a stable account/backend state and locale-independent selectors (the screens expose no test
 * tags or resource ids), so the minimum to add them is: `Modifier.testTag` + `testTagsAsResourceId` on those screens,
 * seed data on the test backend, and one more `By.res(...)` step per journey in the profile block below.
 */
@RunWith(AndroidJUnit4::class)
class BaselineProfileGenerator {

    @get:Rule
    val baselineProfileRule = BaselineProfileRule()

    @Test
    fun generate() {
        val credentials = BenchmarkCredentials.fromArguments()
        baselineProfileRule.collect(
            packageName = TARGET_PACKAGE,
            includeInStartupProfile = true,
        ) {
            if (credentials == null) device.executeShellCommand("pm clear $TARGET_PACKAGE")
            pressHome()
            startActivityAndWait()
            if (credentials == null) {
                waitForLoginScreen()
            } else {
                signInIfNeeded(credentials)
                flingTaskList()
            }
        }
    }
}
