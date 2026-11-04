package com.aedst.core.navigation

import androidx.compose.runtime.mutableStateOf
import androidx.navigation3.runtime.NavKey
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class AedstTabNavigatorTest {

    private val authStack = mutableListOf<NavKey>(LoginKey)
    private val tabStacks = AedstTab.entries.associateWith { mutableListOf<NavKey>(it.root) }

    private fun navigator(signedIn: Boolean = true) =
        AedstTabNavigator(tabStacks, authStack, mutableStateOf(AedstTab.START), signedIn)

    @Test
    fun `signed out shows only the login stack`() {
        val navigator = navigator(signedIn = false)

        assertEquals(LoginKey, navigator.topKey)
        assertFalse(navigator.isAtTabRoot)
    }

    @Test
    fun `navigate pushes on the current tab and ignores a duplicate top`() {
        val navigator = navigator()

        navigator.navigate(TaskDetailKey("1"))
        navigator.navigate(TaskDetailKey("1"))

        assertEquals(listOf<NavKey>(TaskListKey, TaskDetailKey("1")), navigator.stackOf(AedstTab.TASKS))
        assertFalse(navigator.isAtTabRoot)
    }

    @Test
    fun `navigating to a tab root switches tab instead of pushing`() {
        val navigator = navigator()

        navigator.navigate(NotificationsKey)

        assertEquals(AedstTab.NOTIFICATIONS, navigator.currentTab)
        assertEquals(listOf<NavKey>(NotificationsKey), navigator.stackOf(AedstTab.NOTIFICATIONS))
        assertEquals(listOf<NavKey>(TaskListKey), navigator.stackOf(AedstTab.TASKS))
    }

    @Test
    fun `navigating to a tab root resets that tab's stack, switching tabs does not`() {
        val navigator = navigator()
        navigator.navigate(TaskDetailKey("1"))
        navigator.navigate(TaskDetailKey("2"))
        navigator.switchTab(AedstTab.SEARCH)
        navigator.switchTab(AedstTab.TASKS) // the bottom bar: back to the tab as the user left it
        assertEquals(
            listOf<NavKey>(TaskListKey, TaskDetailKey("1"), TaskDetailKey("2")),
            navigator.stackOf(AedstTab.TASKS),
        )

        navigator.navigate(TaskListKey) // a link to the task list: its root, not a stale detail

        assertEquals(listOf<NavKey>(TaskListKey), navigator.stackOf(AedstTab.TASKS))
        assertEquals(AedstTab.TASKS, navigator.currentTab)
        assertTrue(navigator.isAtTabRoot)
    }

    @Test
    fun `navigating to the root of a disabled tab changes nothing`() {
        val navigator = navigator()
        navigator.enabledTabs = setOf(AedstTab.TASKS)
        navigator.navigate(TaskDetailKey("1"))

        navigator.navigate(SearchKey)

        assertEquals(AedstTab.TASKS, navigator.currentTab)
        assertEquals(listOf<NavKey>(TaskListKey, TaskDetailKey("1")), navigator.stackOf(AedstTab.TASKS))
    }

    @Test
    fun `switching tabs keeps every tab's stack`() {
        val navigator = navigator()
        navigator.navigate(TaskDetailKey("1"))

        navigator.switchTab(AedstTab.SEARCH)
        navigator.navigate(TaskDetailKey("2"))
        navigator.switchTab(AedstTab.TASKS)

        assertEquals(TaskDetailKey("1"), navigator.topKey)
        assertEquals(listOf<NavKey>(SearchKey, TaskDetailKey("2")), navigator.stackOf(AedstTab.SEARCH))
    }

    @Test
    fun `back pops the stack then returns to the start tab, then stops`() {
        val navigator = navigator()
        navigator.switchTab(AedstTab.MEDIA)
        navigator.navigate(MediaDetailKey("m1"))

        navigator.back()
        assertEquals(MediaLibraryKey, navigator.topKey)
        assertEquals(AedstTab.MEDIA, navigator.currentTab)

        navigator.back()
        assertEquals(AedstTab.START, navigator.currentTab)

        navigator.back()
        assertEquals(AedstTab.START, navigator.currentTab)
        assertEquals(TaskListKey, navigator.topKey)
    }

    @Test
    fun `replaceTop swaps the create screen for the created task`() {
        val navigator = navigator()
        navigator.navigate(TaskCreateKey)

        navigator.replaceTop(TaskDetailKey("new"))

        assertEquals(listOf<NavKey>(TaskListKey, TaskDetailKey("new")), navigator.stackOf(AedstTab.TASKS))
        navigator.back()
        assertEquals(TaskListKey, navigator.topKey)
    }

    @Test
    fun `signing out resets every stack and the selected tab`() {
        val navigator = navigator()
        navigator.navigate(TaskDetailKey("1"))
        navigator.switchTab(AedstTab.MEDIA)
        navigator.navigate(MediaDetailKey("m1"))

        navigator.setSignedIn(false)

        assertFalse(navigator.isSignedIn)
        assertEquals(LoginKey, navigator.topKey)
        AedstTab.entries.forEach { tab -> assertEquals(listOf<NavKey>(tab.root), navigator.stackOf(tab)) }

        navigator.setSignedIn(true)
        assertEquals(AedstTab.START, navigator.currentTab)
        assertEquals(TaskListKey, navigator.topKey)
        assertTrue(navigator.isAtTabRoot)
    }

    @Test
    fun `back on the login screen does nothing`() {
        val navigator = navigator(signedIn = false)

        navigator.back()

        assertEquals(LoginKey, navigator.topKey)
        assertFalse(navigator.isSignedIn)
    }

    @Test
    fun `completing sign-in lands on the home tab`() {
        val navigator = navigator(signedIn = false)

        navigator.completeSignIn(TaskListKey)

        assertTrue(navigator.isSignedIn)
        assertEquals(AedstTab.TASKS, navigator.currentTab)
        assertEquals(TaskListKey, navigator.topKey)
    }

    @Test
    fun `a disabled tab is not selectable and a link to its root is ignored`() {
        val navigator = navigator()
        navigator.enabledTabs = AedstTab.entries.toSet() - AedstTab.MEDIA

        navigator.switchTab(AedstTab.MEDIA)
        navigator.navigate(MediaLibraryKey)

        assertEquals(AedstTab.TASKS, navigator.currentTab)
        assertFalse(AedstTab.MEDIA in navigator.enabledTabs)
    }

    @Test
    fun `disabling the selected or start tab moves to the first enabled tab and back stops there`() {
        val navigator = navigator()
        navigator.switchTab(AedstTab.TASKS)

        navigator.enabledTabs = setOf(AedstTab.SEARCH, AedstTab.MEDIA)

        assertEquals(AedstTab.SEARCH, navigator.startTab)
        assertEquals(AedstTab.SEARCH, navigator.currentTab)
        navigator.switchTab(AedstTab.MEDIA)
        navigator.back()
        assertEquals(AedstTab.SEARCH, navigator.currentTab)
        navigator.back()
        assertEquals(AedstTab.SEARCH, navigator.currentTab)
    }

    @Test
    fun `the account tab cannot be disabled`() {
        val navigator = navigator()

        navigator.enabledTabs = emptySet()

        assertEquals(setOf(AedstTab.ACCOUNT), navigator.enabledTabs)
        assertEquals(AedstTab.ACCOUNT, navigator.currentTab)
    }
}
