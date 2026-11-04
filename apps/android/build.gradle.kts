plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.android.library) apply false
    alias(libs.plugins.android.test) apply false
    alias(libs.plugins.kotlin.jvm) apply false
    alias(libs.plugins.kotlin.serialization) apply false
    // Registers org.jetbrains.kotlin.plugin.compose's version for the whole
    // build so AndroidComposeConventionPlugin's `pluginManager.apply(id)` can
    // resolve it (see build-logic/convention's other `apply(id)`-without-a-
    // version calls, which all rely on their plugin being declared here too).
    alias(libs.plugins.kotlin.compose) apply false
    alias(libs.plugins.ksp) apply false
    alias(libs.plugins.hilt) apply false
    alias(libs.plugins.detekt) apply false
    alias(libs.plugins.ktlint) apply false
    alias(libs.plugins.kover) apply false
    alias(libs.plugins.google.services) apply false
    alias(libs.plugins.sentry) apply false
    alias(libs.plugins.baseline.profile) apply false
    alias(libs.plugins.roborazzi) apply false
}
