package app.sonora.android.playback

import android.net.Uri
import android.os.Handler
import android.os.Looper
import androidx.media3.common.AudioAttributes
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import app.sonora.android.data.SonoraApi
import com.google.common.util.concurrent.ListenableFuture
import com.google.common.util.concurrent.SettableFuture
import java.io.File
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

@UnstableApi
class PlaybackService : MediaSessionService() {
    private var mediaSession: MediaSession? = null
    private val mainHandler = Handler(Looper.getMainLooper())
    private val resolverExecutor: ExecutorService = Executors.newFixedThreadPool(4)

    override fun onCreate() {
        super.onCreate()
        SonoraApi.initialize(this)
        val player = ExoPlayer.Builder(this).build().apply {
            setAudioAttributes(AudioAttributes.DEFAULT, true)
            setHandleAudioBecomingNoisy(true)
        }
        val callback = object : MediaSession.Callback {
            override fun onPlaybackResumption(
                mediaSession: MediaSession,
                controller: MediaSession.ControllerInfo
            ): ListenableFuture<MediaSession.MediaItemsWithStartPosition> {
                val result = SettableFuture.create<MediaSession.MediaItemsWithStartPosition>()
                resolverExecutor.execute {
                    try {
                        val saved = PlaybackStateStore.load(this@PlaybackService)
                            ?: throw IllegalStateException("No saved SONORA playback queue.")

                        // Resolve on the callback's worker thread. Do not submit nested tasks to
                        // the same bounded executor and wait for them, which can deadlock when
                        // several controllers request resumption at once.
                        val tracks = saved.tracks.mapNotNull { savedTrack ->
                            val localUri = savedTrack.audioUrl?.takeIf { it.startsWith("file:") }
                            val resolved = if (localUri != null) {
                                val localFile = File(Uri.parse(localUri).path.orEmpty())
                                savedTrack.takeIf { localFile.isFile }
                            } else {
                                runCatching {
                                    SonoraApi.resolveTrack(savedTrack.provider, savedTrack.providerTrackId)
                                }.getOrNull()
                            }
                            resolved?.takeIf { it.playable && !it.audioUrl.isNullOrBlank() }
                        }
                        if (tracks.isEmpty()) throw IllegalStateException("No saved tracks are currently playable.")

                        val savedCurrent = saved.tracks.getOrNull(saved.currentIndex)
                        val restoredIndex = savedCurrent?.let { target ->
                            tracks.indexOfFirst {
                                it.provider == target.provider && it.providerTrackId == target.providerTrackId
                            }
                        } ?: -1
                        val startIndex = restoredIndex.takeIf { it >= 0 } ?: 0
                        val requestedPosition = if (restoredIndex >= 0) saved.positionMs else 0L
                        val items = tracks.map { track ->
                            val metadata = MediaMetadata.Builder()
                                .setTitle(track.title)
                                .setArtist(track.artist)
                                .setAlbumTitle(track.album)
                                .setArtworkUri(track.artworkUrl?.let(Uri::parse))
                                .build()
                            MediaItem.Builder()
                                .setMediaId("${track.provider}:${track.id}")
                                .setUri(track.audioUrl!!)
                                .setMediaMetadata(metadata)
                                .build()
                        }
                        val startPosition = requestedPosition.coerceAtMost(
                            (tracks[startIndex].durationSeconds.coerceAtLeast(0) * 1000L)
                                .takeIf { it > 0L } ?: requestedPosition
                        )
                        mainHandler.post {
                            mediaSession.player.shuffleModeEnabled = saved.shuffleEnabled
                            mediaSession.player.repeatMode = saved.repeatMode
                            result.set(MediaSession.MediaItemsWithStartPosition(items, startIndex, startPosition))
                        }
                    } catch (error: Exception) {
                        result.setException(error)
                    }
                }
                return result
            }
        }
        mediaSession = MediaSession.Builder(this, player).setCallback(callback).build()
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? = mediaSession

    override fun onDestroy() {
        mediaSession?.run {
            player.release()
            release()
        }
        mediaSession = null
        resolverExecutor.shutdownNow()
        super.onDestroy()
    }
}
