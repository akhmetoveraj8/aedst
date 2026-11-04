package com.aedst.core.navigation

import androidx.navigation3.runtime.NavKey
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class AedstStackNavigatorTest {

    private val stack = mutableListOf<NavKey>(LoginKey)
    private val navigator = AedstStackNavigator(stack)

    @Test
    fun `navigate pushes and back pops but never empties the stack`() {
        navigator.navigate(AccountKey)
        navigator.navigate(AccountKey)
        assertEquals(listOf<NavKey>(LoginKey, AccountKey), navigator.keys)

        navigator.back()
        navigator.back()
        assertEquals(listOf<NavKey>(LoginKey), navigator.keys)
    }

    @Test
    fun `replaceTop swaps the last key`() {
        navigator.navigate(TaskCreateKey)

        navigator.replaceTop(TaskDetailKey("1"))

        assertEquals(listOf<NavKey>(LoginKey, TaskDetailKey("1")), navigator.keys)
    }

    @Test
    fun `completeSignIn replaces the whole stack with home`() {
        navigator.navigate(AccountKey)

        navigator.completeSignIn(AccountKey)

        assertEquals(listOf<NavKey>(AccountKey), navigator.keys)
    }
}
