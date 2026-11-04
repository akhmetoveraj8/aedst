package com.aedst.core.navigation

import androidx.navigation3.runtime.NavKey

/**
 * A navigator over one plain back stack, for hosts without tabs (the TV app). [stack] is typically the list from
 * `rememberNavBackStack`, so it survives process death; it must never be empty.
 */
class AedstStackNavigator(private val stack: MutableList<NavKey>) : AedstNavigator {

    init {
        require(stack.isNotEmpty()) { "A back stack needs at least one key" }
    }

    /** The stack to hand to `NavDisplay`. */
    val keys: List<NavKey> get() = stack

    override fun navigate(key: NavKey) {
        if (stack.last() != key) stack.add(key)
    }

    override fun back() {
        if (stack.size > 1) stack.removeAt(stack.lastIndex)
    }

    override fun replaceTop(key: NavKey) {
        stack[stack.lastIndex] = key
    }

    override fun completeSignIn(home: NavKey) {
        stack.clear()
        stack.add(home)
    }
}
