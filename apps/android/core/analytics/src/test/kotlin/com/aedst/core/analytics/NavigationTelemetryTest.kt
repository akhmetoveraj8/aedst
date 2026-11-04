package com.aedst.core.analytics

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import javax.inject.Singleton

class NavigationTelemetryTest {

    private val screens = mutableListOf<String>()
    private val telemetry = NavigationTelemetry(
        object : AnalyticsTracker {
            override fun logEvent(name: String, params: Map<String, Any?>) = Unit

            override fun screen(name: String) {
                screens += name
            }
        },
    )

    @Test
    fun `each screen change is reported once, in order`() {
        telemetry.onScreenChanged("tasks")
        telemetry.onScreenChanged("tasks")
        telemetry.onScreenChanged("tasks/{taskId}")
        telemetry.onScreenChanged("tasks")

        assertEquals(listOf("tasks", "tasks/{taskId}", "tasks"), screens)
    }

    @Test
    fun `one instance serves the whole process, so an activity recreate does not repeat the screen view`() {
        // The activity gets it injected: without @Singleton Hilt would build a fresh one (and a null lastScreen) per recreate.
        assertTrue(NavigationTelemetry::class.java.isAnnotationPresent(Singleton::class.java))
    }
}
