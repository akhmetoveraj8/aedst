package com.aedst.core.common

import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class OutcomeTest {

    @Test
    fun `runCatchingOutcome wraps successful block`() = runTest {
        val outcome = runCatchingOutcome { 42 }
        assertEquals(Outcome.Success(42), outcome)
    }

    @Test
    fun `runCatchingOutcome wraps thrown AedstError`() = runTest {
        val outcome = runCatchingOutcome<Int> { throw AedstError.NotFound() }
        assertTrue(outcome is Outcome.Failure)
    }

    @Test
    fun `map transforms success value only`() {
        val success: Outcome<Int> = Outcome.Success(2)
        assertEquals(Outcome.Success(4), success.map { it * 2 })
    }
}
