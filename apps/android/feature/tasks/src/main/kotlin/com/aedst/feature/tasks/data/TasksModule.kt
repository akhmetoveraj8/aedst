package com.aedst.feature.tasks.data

import com.aedst.core.outbox.OutboxHandler
import com.aedst.feature.tasks.domain.TaskRepository
import com.aedst.feature.tasks.domain.TaskWriteQueue
import com.aedst.tasks.v1.TasksServiceClient
import com.aedst.tasks.v1.TasksServiceClientInterface
import com.connectrpc.ProtocolClientInterface
import dagger.Binds
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import dagger.multibindings.IntoSet
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
internal abstract class TasksModule {

    @Binds
    abstract fun bindTaskRepository(impl: ConnectTaskRepository): TaskRepository

    @Binds
    abstract fun bindTaskWriteQueue(impl: OutboxTaskWriteQueue): TaskWriteQueue

    // One handler per queued write type; core/outbox routes a row to the handler whose `type` matches.
    @Binds
    @IntoSet
    abstract fun bindTaskCreateHandler(impl: TaskCreateOutboxHandler): OutboxHandler

    @Binds
    @IntoSet
    abstract fun bindTaskCompleteHandler(impl: TaskCompleteOutboxHandler): OutboxHandler

    @Binds
    @IntoSet
    abstract fun bindTaskUpdateHandler(impl: TaskUpdateOutboxHandler): OutboxHandler

    companion object {
        @Provides
        @Singleton
        fun provideTasksServiceClient(client: ProtocolClientInterface): TasksServiceClientInterface =
            TasksServiceClient(client)
    }
}
