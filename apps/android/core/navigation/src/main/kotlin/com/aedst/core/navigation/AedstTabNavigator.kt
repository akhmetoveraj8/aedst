package com.aedst.core.navigation

import androidx.compose.runtime.MutableState
import androidx.compose.runtime.mutableStateOf
import androidx.navigation3.runtime.NavKey

/**
 * Back-stack rules of the phone app, in plain Kotlin (no Compose UI) so they are unit-testable:
 *
 *  - signed out: only [authStack] (`[LoginKey]`) is active;
 *  - signed in: one stack per [AedstTab], each rooted at the tab's root key. Switching tabs keeps every stack (and,
 *    through the entry decorators in `app/`, every screen's ViewModel and saved state), like the previous
 *    `saveState`/`restoreState` behaviour; going back from a non-start tab's root returns to [AedstTab.START];
 *  - signing out ([setSignedIn] with `false`) resets every stack, so the next user never sees the previous one's
 *    screens.
 *
 * The stacks are mutated in place so they can be `rememberNavBackStack` lists (saved across process death);
 * [currentTab] is saved by the caller through the [tabState] it passes in.
 */
class AedstTabNavigator(
    private val tabStacks: Map<AedstTab, MutableList<NavKey>>,
    private val authStack: MutableList<NavKey>,
    private val tabState: MutableState<AedstTab>,
    isSignedIn: Boolean,
) : AedstNavigator {

    private val signedInState = mutableStateOf(isSignedIn)
    private val enabledTabsState = mutableStateOf(AedstTab.entries.toSet())

    init {
        require(AedstTab.entries.all { tabStacks[it]?.isNotEmpty() == true }) { "Every tab needs a rooted stack" }
        require(authStack.isNotEmpty()) { "The auth stack needs a login key" }
    }

    val isSignedIn: Boolean get() = signedInState.value

    val currentTab: AedstTab get() = tabState.value

    /**
     * The tabs the shell offers (capability negotiation turns features off); every tab until set. The account tab is
     * always kept. A disabled tab is no longer selectable, a deep link to its root is ignored, and when it is the
     * selected one the shell moves to [startTab].
     */
    var enabledTabs: Set<AedstTab>
        get() = enabledTabsState.value
        set(tabs) {
            enabledTabsState.value = tabs + AedstTab.ACCOUNT
            if (currentTab !in enabledTabsState.value) tabState.value = startTab
        }

    /** [AedstTab.START] while it is enabled, else the first enabled tab; the account tab is always enabled. */
    val startTab: AedstTab
        get() = AedstTab.START.takeIf { it in enabledTabs } ?: AedstTab.entries.first { it in enabledTabs }

    /** The back stack of [tab]; shown (together with the start tab's root) while that tab is selected. */
    fun stackOf(tab: AedstTab): List<NavKey> = mutableStackOf(tab)

    /** The signed-out stack (`[LoginKey]`). */
    val signedOutStack: List<NavKey> get() = authStack

    /** The destination on screen, for analytics. */
    val topKey: NavKey get() = activeStack().last()

    /** `true` when the top-level navigation should be shown: signed in and at the root of the current tab. */
    val isAtTabRoot: Boolean get() = isSignedIn && activeStack().size == 1

    private fun mutableStackOf(tab: AedstTab): MutableList<NavKey> = checkNotNull(tabStacks[tab])

    private fun activeStack(): MutableList<NavKey> = if (isSignedIn) mutableStackOf(currentTab) else authStack

    /** Applies the session state; call whenever `SessionState.isSignedIn` changes. */
    fun setSignedIn(signedIn: Boolean) {
        if (!signedIn) resetAll()
        signedInState.value = signedIn
    }

    /** Selects [tab] (keeping every tab's stack); selecting the current tab again does nothing. */
    fun switchTab(tab: AedstTab) {
        if (isSignedIn && tab in enabledTabs) tabState.value = tab
    }

    /**
     * A tab's root key opens that tab *at its root*: the tab is selected and its stack reset, so "go to the task list"
     * (a link, a notification, `completeSignIn`) never lands on a stale detail screen left on that tab. A disabled tab
     * is ignored. Any other key is pushed on the current stack (a duplicate of the top is dropped).
     * To come back to a tab as the user left it, use [switchTab] (the bottom bar does).
     */
    override fun navigate(key: NavKey) {
        val tab = AedstTab.forRoot(key)
        val stack = activeStack()
        when {
            isSignedIn && tab != null -> if (tab in enabledTabs) {
                resetTo(mutableStackOf(tab), tab.root)
                tabState.value = tab
            }
            stack.last() != key -> stack.add(key)
        }
    }

    override fun back() {
        val stack = activeStack()
        when {
            stack.size > 1 -> stack.removeAt(stack.lastIndex)
            isSignedIn && currentTab != startTab -> tabState.value = startTab
        }
    }

    override fun replaceTop(key: NavKey) {
        val stack = activeStack()
        stack[stack.lastIndex] = key
    }

    override fun completeSignIn(home: NavKey) {
        signedInState.value = true
        navigate(home)
    }

    private fun resetAll() {
        AedstTab.entries.forEach { tab -> resetTo(mutableStackOf(tab), tab.root) }
        resetTo(authStack, LoginKey)
        tabState.value = startTab
    }

    private fun resetTo(stack: MutableList<NavKey>, root: NavKey) {
        if (stack.size == 1 && stack.first() == root) return
        stack.clear()
        stack.add(root)
    }
}
