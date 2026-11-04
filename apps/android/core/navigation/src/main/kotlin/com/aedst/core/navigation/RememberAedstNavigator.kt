package com.aedst.core.navigation

import androidx.compose.runtime.Composable
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.navigation3.runtime.NavKey
import androidx.navigation3.runtime.rememberNavBackStack

/**
 * The signed-in/out shell's navigator. Every stack is a `rememberNavBackStack` list and the selected tab is
 * `rememberSaveable`, so the whole navigation state survives configuration changes and process death. On Android
 * `rememberNavBackStack` serialises each key with its own `@Serializable` serializer (class name + generated
 * serializer, see `consumer-rules.pro`), so no polymorphic serializers module is needed.
 *
 * @param isSignedIn the already restored session state; the caller draws nothing while it is still unknown.
 */
@Composable
fun rememberAedstTabNavigator(isSignedIn: Boolean): AedstTabNavigator {
    val authStack = rememberNavBackStack(LoginKey)
    val tabState = rememberSaveable { mutableStateOf(AedstTab.START) }
    val tabStacks = AedstTab.entries.associateWith { tab -> key(tab) { rememberNavBackStack(tab.root) } }
    return remember { AedstTabNavigator(tabStacks, authStack, tabState, isSignedIn) }
}

/** A single saved back stack starting at [start], for hosts without tabs (the TV app). */
@Composable
fun rememberAedstStackNavigator(start: NavKey): AedstStackNavigator {
    val stack = rememberNavBackStack(start)
    return remember(stack) { AedstStackNavigator(stack) }
}
