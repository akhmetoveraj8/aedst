package com.aedst.core.testing

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.jupiter.api.extension.AfterEachCallback
import org.junit.jupiter.api.extension.BeforeEachCallback
import org.junit.jupiter.api.extension.ExtensionContext

/**
 * Swaps `Dispatchers.Main` for a test dispatcher for the duration of each test (JUnit 6 / Jupiter replacement of the
 * former JUnit 4 `MainDispatcherRule`). Register it per test class:
 *
 * ```
 * @JvmField
 * @RegisterExtension
 * val mainDispatcher = MainDispatcherExtension()
 * ```
 */
@OptIn(ExperimentalCoroutinesApi::class)
class MainDispatcherExtension(val testDispatcher: TestDispatcher = StandardTestDispatcher()) :
    BeforeEachCallback,
    AfterEachCallback {
    override fun beforeEach(context: ExtensionContext) {
        Dispatchers.setMain(testDispatcher)
    }

    override fun afterEach(context: ExtensionContext) {
        Dispatchers.resetMain()
    }
}
