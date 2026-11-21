package com.aedst.core.ui.components

import android.content.res.Configuration
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.aedst.core.ui.R
import com.aedst.core.ui.theme.AedstSpacing
import com.aedst.core.ui.theme.AedstTheme
import kotlinx.coroutines.launch

/**
 * Swipeable pages with previous / next buttons and a "Slide n of m" label, mirroring web's `carousel.tsx`. Built on
 * the Compose foundation [HorizontalPager] (swipe direction follows the layout direction). The position label is a
 * polite live region, so a screen reader hears the new slide number after a button press.
 */
@Composable
fun AedstCarousel(
    pageCount: Int,
    modifier: Modifier = Modifier,
    initialPage: Int = 0,
    page: @Composable (index: Int) -> Unit,
) {
    val state = rememberPagerState(initialPage = initialPage) { pageCount }
    val scope = rememberCoroutineScope()
    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(AedstSpacing.sm)) {
        HorizontalPager(state = state, modifier = Modifier.fillMaxWidth(), pageSpacing = AedstSpacing.sm) { index ->
            page(index)
        }
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            AedstIconButton(
                onClick = { scope.launch { state.animateScrollToPage(state.currentPage - 1) } },
                contentDescription = stringResource(R.string.aedst_a11y_previous),
                enabled = state.currentPage > 0,
                variant = AedstIconButtonVariant.OUTLINE,
            ) {
                Icon(Icons.AutoMirrored.Filled.KeyboardArrowLeft, contentDescription = null)
            }
            Text(
                text = stringResource(R.string.aedst_a11y_slide, state.currentPage + 1, pageCount),
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
            )
            AedstIconButton(
                onClick = { scope.launch { state.animateScrollToPage(state.currentPage + 1) } },
                contentDescription = stringResource(R.string.aedst_a11y_next),
                enabled = state.currentPage < pageCount - 1,
                variant = AedstIconButtonVariant.OUTLINE,
            ) {
                Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null)
            }
        }
    }
}

@Preview(name = "Light", showBackground = true)
@Preview(name = "Dark", uiMode = Configuration.UI_MODE_NIGHT_YES, showBackground = true)
@Composable
private fun AedstCarouselPreview() {
    AedstTheme {
        Surface {
            AedstCarousel(pageCount = 3, modifier = Modifier.padding(AedstSpacing.lg)) { index ->
                AedstCard {
                    Box(modifier = Modifier.fillMaxWidth().height(120.dp), contentAlignment = Alignment.Center) {
                        Text("Slide ${index + 1}")
                    }
                }
            }
        }
    }
}
