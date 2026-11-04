package com.aedst.core.database

import androidx.room3.Dao
import androidx.room3.Insert
import androidx.room3.OnConflictStrategy
import androidx.room3.Query
import kotlinx.coroutines.flow.Flow

/**
 * Enum values are stored by name, so the state literals in the queries below must match [OutboxState].
 *
 * A DAO is a flat list of one-line queries; splitting it only to stay under the function count would scatter the
 * single outbox table over two interfaces, hence the suppression.
 */
@Dao
@Suppress("TooManyFunctions")
interface OutboxDao {
    /** Ignores a duplicate [OutboxEntity.id] (returns -1), so enqueueing one logical operation twice is harmless. */
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insert(entity: OutboxEntity): Long

    /** Oldest first: operations are delivered in the order the user performed them. */
    @Query("SELECT * FROM outbox WHERE state = 'PENDING' ORDER BY createdAtEpochMs ASC, id ASC LIMIT :limit")
    suspend fun pending(limit: Int): List<OutboxEntity>

    @Query("SELECT * FROM outbox WHERE state = 'FAILED' ORDER BY createdAtEpochMs ASC, id ASC LIMIT :limit")
    suspend fun failed(limit: Int): List<OutboxEntity>

    @Query("SELECT COUNT(*) FROM outbox WHERE state = 'PENDING'")
    fun observePendingCount(): Flow<Int>

    /** Parked items the user has not dealt with yet (drives the "could not be synced" alert with retry / discard). */
    @Query("SELECT COUNT(*) FROM outbox WHERE state = 'FAILED'")
    fun observeFailedCount(): Flow<Int>

    @Query("DELETE FROM outbox WHERE id = :id")
    suspend fun delete(id: String)

    /** Sign-out: queued writes belong to the user who made them and must never be sent under the next session. */
    @Query("DELETE FROM outbox")
    suspend fun deleteAll()

    /** User chose "retry": parked items become pending again with a fresh attempt budget. Returns how many. */
    @Query("UPDATE outbox SET state = 'PENDING', attempts = 0, lastError = NULL WHERE state = 'FAILED'")
    suspend fun requeueFailed(): Int

    /** User chose "discard": drops every parked item. Returns how many. */
    @Query("DELETE FROM outbox WHERE state = 'FAILED'")
    suspend fun deleteFailed(): Int

    @Query("UPDATE outbox SET attempts = attempts + 1, lastError = :lastError WHERE id = :id")
    suspend fun recordAttempt(id: String, lastError: String?)

    /**
     * Parks the item. `attempts` is left as the number of retryable failures already recorded (docs/contract/behavior/
     * offline-outbox.json: an item parked on its 8th failure shows 7), not bumped for the final one.
     */
    @Query("UPDATE outbox SET state = 'FAILED', lastError = :lastError WHERE id = :id")
    suspend fun markFailed(id: String, lastError: String?)

    /** Housekeeping: drop dead entries older than [olderThanEpochMs] so the table cannot grow without bound. */
    @Query("DELETE FROM outbox WHERE state = 'FAILED' AND createdAtEpochMs < :olderThanEpochMs")
    suspend fun deleteFailedOlderThan(olderThanEpochMs: Long): Int
}
