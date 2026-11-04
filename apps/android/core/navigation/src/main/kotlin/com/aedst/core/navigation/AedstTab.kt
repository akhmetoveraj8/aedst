package com.aedst.core.navigation

import androidx.navigation3.runtime.NavKey
import com.aedst.core.common.AedstFeature

/**
 * The top-level destinations of the signed-in shell, each with its own back stack rooted at [root].
 *
 * @property feature the capability id (`AedstFeature`) that has to be enabled for the tab to be offered; `null` for a
 *   tab that is always there (the account tab holds sign-out).
 */
enum class AedstTab(val root: AedstKey, val feature: String?) {
    TASKS(TaskListKey, AedstFeature.TASKS),
    SEARCH(SearchKey, AedstFeature.SEARCH),
    NOTIFICATIONS(NotificationsKey, AedstFeature.NOTIFICATIONS),
    MEDIA(MediaLibraryKey, AedstFeature.MEDIA),
    ACCOUNT(AccountKey, null),
    ADMIN(AdminKey, AedstFeature.ADMIN),
    ;

    companion object {
        /** The tab shown after sign-in when it is enabled; going back from another tab's root returns here. */
        val START: AedstTab = TASKS

        /** The tab whose root is [key], or `null` when [key] is not a top-level destination. */
        fun forRoot(key: NavKey): AedstTab? = entries.firstOrNull { it.root == key }
    }
}
