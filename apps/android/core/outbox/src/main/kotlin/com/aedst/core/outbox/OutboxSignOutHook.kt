package com.aedst.core.outbox

import com.aedst.core.common.SignOutHook
import com.aedst.core.database.OutboxDao
import javax.inject.Inject

/**
 * Queued writes belong to the user who made them. When the session ends (explicit sign-out or a refresh token the IdP
 * rejected) the pending sync is cancelled first, then the table is emptied, so the next user of the device never
 * sends the previous user's operations under their own token.
 */
class OutboxSignOutHook @Inject constructor(private val scheduler: OutboxScheduler, private val dao: OutboxDao) :
    SignOutHook {
    override suspend fun onSessionEnded() {
        scheduler.cancel()
        dao.deleteAll()
    }
}
