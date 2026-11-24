package com.aedst.core.database

import android.content.Context
import androidx.room3.Room
import androidx.sqlite.driver.AndroidSQLiteDriver
import com.aedst.core.common.ApplicationContext
import dev.zacsweers.metro.AppScope
import dev.zacsweers.metro.BindingContainer
import dev.zacsweers.metro.ContributesTo
import dev.zacsweers.metro.Provides
import dev.zacsweers.metro.SingleIn

@BindingContainer
@ContributesTo(AppScope::class)
public object DatabaseModule {

    private const val DATABASE_NAME = "aedst.db"

    @Provides
    @SingleIn(AppScope::class)
    public fun provideAppDatabase(@ApplicationContext context: Context): AppDatabase =
        Room.databaseBuilder(context, AppDatabase::class.java, DATABASE_NAME)
            .setDriver(AndroidSQLiteDriver())
            .build()

    @Provides
    public fun provideOutboxDao(database: AppDatabase): OutboxDao = database.outboxDao()
}
