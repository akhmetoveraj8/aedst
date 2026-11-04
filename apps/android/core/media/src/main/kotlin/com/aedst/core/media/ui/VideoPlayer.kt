package com.aedst.core.media.ui

import androidx.annotation.OptIn
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.FilledTonalIconButton
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.LifecycleStartEffect
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.compose.ContentFrame
import com.aedst.core.media.R
import com.aedst.core.ui.theme.AedstSpacing

/**
 * Plays a (presigned) video URL with **Media3 ExoPlayer** rendered by `media3-ui-compose`'s [ContentFrame]
 * (PlayerSurface + aspect-ratio handling + shutter until the first frame). The player is created per composition,
 * paused when the lifecycle stops and released when the composable leaves — no leaked codecs.
 */
@OptIn(UnstableApi::class)
@Composable
fun VideoPlayer(url: String, modifier: Modifier = Modifier, autoPlay: Boolean = false) {
    val context = LocalContext.current
    val player = remember(url) {
        ExoPlayer.Builder(context.applicationContext).build().apply {
            setMediaItem(MediaItem.fromUri(url))
            playWhenReady = autoPlay
            prepare()
        }
    }
    DisposableEffect(player) { onDispose { player.release() } }
    LifecycleStartEffect(player) { onStopOrDispose { player.pause() } }

    var isPlaying by remember(player) { mutableStateOf(player.isPlaying) }
    DisposableEffect(player) {
        val listener = object : Player.Listener {
            override fun onIsPlayingChanged(playing: Boolean) {
                isPlaying = playing
            }
        }
        player.addListener(listener)
        onDispose { player.removeListener(listener) }
    }

    Box(modifier = modifier.background(Color.Black), contentAlignment = Alignment.Center) {
        ContentFrame(player = player)
        FilledTonalIconButton(
            onClick = { if (isPlaying) player.pause() else player.play() },
            modifier = Modifier.align(Alignment.BottomStart).padding(AedstSpacing.md),
        ) {
            Icon(
                imageVector = if (isPlaying) Icons.Filled.Pause else Icons.Filled.PlayArrow,
                contentDescription = stringResource(if (isPlaying) R.string.media_pause else R.string.media_play),
            )
        }
    }
}
