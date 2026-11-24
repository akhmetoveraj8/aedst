package com.aedst.core.common

import androidx.lifecycle.ViewModel
import dev.zacsweers.metro.AppScope
import dev.zacsweers.metro.ContributesBinding
import dev.zacsweers.metro.Inject
import dev.zacsweers.metro.SingleIn
import dev.zacsweers.metrox.viewmodel.ManualViewModelAssistedFactory
import dev.zacsweers.metrox.viewmodel.MetroViewModelFactory
import dev.zacsweers.metrox.viewmodel.ViewModelAssistedFactory
import kotlin.reflect.KClass

/**
 * The one [MetroViewModelFactory] of the app (Metro's replacement for Hilt's ViewModel factory): the phone and the TV
 * application bind it through the aggregation, then provide it to Compose as `LocalMetroViewModelFactory` and to
 * `ComponentActivity` as `defaultViewModelProviderFactory`.
 */
@SingleIn(AppScope::class)
@ContributesBinding(AppScope::class)
@Inject
public class AedstViewModelFactory(
    override val viewModelProviders: Map<KClass<out ViewModel>, () -> ViewModel>,
    override val assistedFactoryProviders: Map<KClass<out ViewModel>, () -> ViewModelAssistedFactory>,
    override val manualAssistedFactoryProviders:
    Map<KClass<out ManualViewModelAssistedFactory>, () -> ManualViewModelAssistedFactory>,
) : MetroViewModelFactory()
