package com.aedst.feature.tasks.data

import com.aedst.core.common.NetworkMonitor
import com.aedst.feature.tasks.domain.CompleteTaskUseCase
import com.aedst.feature.tasks.domain.CreateTaskUseCase
import com.aedst.feature.tasks.domain.TaskRepository
import com.aedst.feature.tasks.domain.TaskWriteQueue
import com.aedst.tasks.v1.TasksServiceClient
import com.aedst.tasks.v1.TasksServiceClientInterface
import com.connectrpc.ProtocolClientInterface
import dev.zacsweers.metro.AppScope
import dev.zacsweers.metro.BindingContainer
import dev.zacsweers.metro.ContributesTo
import dev.zacsweers.metro.Provides
import dev.zacsweers.metro.SingleIn

/**
 * Metro follows Kotlin visibility, so this container is public (and mentions only public types) while the classes it
 * relies on stay `internal`: the repository, the write queue and the outbox handlers contribute their own bindings
 * (`@ContributesBinding` / `@ContributesIntoSet`) through generated providers.
 */
@BindingContainer
@ContributesTo(AppScope::class)
object TasksProviders {
    @Provides
    @SingleIn(AppScope::class)
    fun provideTasksServiceClient(client: ProtocolClientInterface): TasksServiceClientInterface =
        TasksServiceClient(client)

    // Use cases live in the common-code domain module, which has no DI annotations: they are constructed here.
    @Provides
    fun provideCreateTaskUseCase(
        repository: TaskRepository,
        queue: TaskWriteQueue,
        network: NetworkMonitor,
    ): CreateTaskUseCase = CreateTaskUseCase(repository, queue, network)

    @Provides
    fun provideCompleteTaskUseCase(
        repository: TaskRepository,
        queue: TaskWriteQueue,
        network: NetworkMonitor,
    ): CompleteTaskUseCase = CompleteTaskUseCase(repository, queue, network)
}
