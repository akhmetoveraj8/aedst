package com.aedst.feature.notifications.data

import app.cash.turbine.test
import com.aedst.feature.notifications.presentation.UnreadBadgeViewModel
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class UnreadCountStoreTest {

    private val store = UnreadCountStore()

    @Test
    fun `starts at zero`() {
        assertEquals(0, store.count.value)
    }

    @Test
    fun `set never goes below zero`() {
        store.set(7)
        assertEquals(7, store.count.value)

        store.set(-3)

        assertEquals(0, store.count.value)
    }

    @Test
    fun `decrementing stops at zero`() {
        store.set(2)

        store.decrementBy(5)

        assertEquals(0, store.count.value)
    }

    @Test
    fun `the end of a session resets the badge for the next user`() = runTest {
        store.set(4)

        UnreadCountSignOutHook(store).onSessionEnded()

        assertEquals(0, store.count.value)
    }

    @Test
    fun `the badge view model follows the shared store`() = runTest {
        val badge = UnreadBadgeViewModel(store)

        badge.unread.test {
            assertEquals(0, awaitItem())
            store.set(4)
            assertEquals(4, awaitItem())
            store.decrementBy(1)
            assertEquals(3, awaitItem())
        }
    }
}
