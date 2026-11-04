package com.aedst.feature.admin.navigation

import androidx.navigation3.runtime.EntryProviderScope
import androidx.navigation3.runtime.NavKey
import com.aedst.core.navigation.AdminKey
import com.aedst.core.navigation.AedstNavGraph
import com.aedst.core.navigation.AedstNavigator
import com.aedst.feature.admin.presentation.AdminRoute

/**
 * feature/admin's public boundary. `app/` only shows the entry point to users whose token carries the `admin` role,
 * and the screen re-checks it; the server enforces the role on every AdminService RPC regardless.
 */
class AdminNavGraph : AedstNavGraph {
    override fun register(scope: EntryProviderScope<NavKey>, navigator: AedstNavigator) {
        scope.entry<AdminKey> { AdminRoute() }
    }
}
