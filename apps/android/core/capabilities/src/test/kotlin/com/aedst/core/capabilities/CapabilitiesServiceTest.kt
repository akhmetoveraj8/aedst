package com.aedst.core.capabilities

import app.cash.turbine.test
import com.aedst.capabilities.v1.GetCapabilitiesResponse
import com.aedst.capabilities.v1.UpdateStatus
import com.aedst.capabilities.v1.clientVersions
import com.aedst.capabilities.v1.feature
import com.aedst.capabilities.v1.getCapabilitiesResponse
import com.aedst.core.common.AedstError
import com.aedst.core.network.ClientUpgradeGate
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset

class CapabilitiesServiceTest {
    private val build = ClientBuild(
        platform = "android",
        version = "1.3.0",
        features = setOf("tasks", "media", "search", "admin", "notifications", "auth"),
        flagged = setOf("admin"),
    )
    private val cache = FakeCache()
    private val gate = ClientUpgradeGate()
    private var now = Instant.parse("2026-10-08T10:00:00Z")
    private val clock = object : Clock() {
        override fun getZone() = ZoneOffset.UTC
        override fun withZone(zone: java.time.ZoneId?) = this
        override fun instant(): Instant = now
    }
    private var answer: () -> GetCapabilitiesResponse = { error("no answer") }
    private var fetches = 0
    private val remote = CapabilitiesRemote {
        fetches++
        answer()
    }
    private val repository = CapabilitiesService(remote, cache, build, gate, clock)

    @Test
    fun `defaults without any fetch are the built-in features minus the flagged ones`() = runTest {
        val shown = repository.availability.first().enabled
        assertEquals(setOf("tasks", "media", "search", "notifications", "auth"), shown)
        assertEquals(shown, repository.defaults.enabled)
    }

    @Test
    fun `a successful fetch is cached and applied`() = runTest {
        answer = { getCapabilitiesResponse { features["search"] = feature { enabled = false } } }
        repository.availability.test {
            assertTrue(awaitItem().isEnabled("search"))
            repository.refresh()
            assertFalse(awaitItem().isEnabled("search"))
        }
    }

    @Test
    fun `a failed fetch keeps the last known answer`() = runTest {
        answer = { getCapabilitiesResponse { features["admin"] = feature { enabled = true } } }
        repository.refresh()
        answer = { throw AedstError.Offline() }
        repository.refresh(force = true)
        assertTrue(repository.availability.first().isEnabled("admin"))
        assertEquals(2, fetches)
    }

    @Test
    fun `refresh is throttled unless forced`() = runTest {
        answer = { getCapabilitiesResponse {} }
        repository.refresh()
        repository.refresh()
        assertEquals(1, fetches)
        now = now.plusSeconds(301)
        repository.refresh()
        assertEquals(2, fetches)
        repository.refresh(force = true)
        assertEquals(3, fetches)
    }

    @Test
    fun `a window above this build latches the upgrade screen`() = runTest {
        answer = { getCapabilitiesResponse { clients["android"] = clientVersions { minimum = "1.4.0" } } }
        repository.refresh()
        assertTrue(gate.upgradeRequired.value)
    }

    @Test
    fun `a window at or below this build does not`() = runTest {
        answer = { getCapabilitiesResponse { clients["android"] = clientVersions { minimum = "1.3.0" } } }
        repository.refresh()
        assertFalse(gate.upgradeRequired.value)
    }

    @Test
    fun `recommended window or update status asks for a non-blocking update`() = runTest {
        answer = { getCapabilitiesResponse { clients["android"] = clientVersions { recommended = "1.10.0" } } }
        repository.refresh()
        assertTrue(repository.availability.first().updateRecommended)

        answer = { getCapabilitiesResponse { updateStatus = UpdateStatus.UPDATE_STATUS_RECOMMENDED } }
        repository.refresh(force = true)
        assertTrue(repository.availability.first().updateRecommended)

        answer = { getCapabilitiesResponse { clients["android"] = clientVersions { recommended = "1.3.0" } } }
        repository.refresh(force = true)
        assertFalse(repository.availability.first().updateRecommended)
    }

    @Test
    fun `requiredClientVersion param hides a feature on an older build`() = runTest {
        answer = {
            getCapabilitiesResponse {
                features["media"] = feature {
                    enabled = true
                    requiredClientVersion = "1.4.0"
                }
            }
        }
        repository.refresh()
        assertFalse(repository.availability.first().isEnabled("media"))
    }

    @Test
    fun `version order is numeric per component`() {
        assertEquals(true, (VersionOrder.compare("1.10.0", "1.9.0") ?: 0) > 0)
        assertEquals(0, VersionOrder.compare("1.3", "1.3.0"))
        assertEquals(null, VersionOrder.compare("1.3.0-rc1", "1.3.0"))
    }

    private class FakeCache : CapabilitiesCache {
        private val state = MutableStateFlow<GetCapabilitiesResponse?>(null)
        override val lastKnown = state
        override suspend fun save(response: GetCapabilitiesResponse) {
            state.value = response
        }
    }
}
