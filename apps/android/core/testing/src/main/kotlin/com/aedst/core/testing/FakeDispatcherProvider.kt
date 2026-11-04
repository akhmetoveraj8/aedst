package com.aedst.core.testing

import com.aedst.core.common.DispatcherProvider
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestDispatcher

/** Single test dispatcher for all three roles, so use-case tests run deterministically under `runTest`. */
class FakeDispatcherProvider(dispatcher: TestDispatcher = StandardTestDispatcher()) : DispatcherProvider {
    override val main = dispatcher
    override val io = dispatcher
    override val default = dispatcher
}
