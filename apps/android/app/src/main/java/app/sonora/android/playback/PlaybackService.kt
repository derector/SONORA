package app.sonora.android.playback

import android.content.Context
import android.net.Uri
import androidx.media3.common.AudioAttributes
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

class PlaybackService : MediaSessionService() {
    private var mediaSession: MediaSession? = null
    private var exoPlayer: ExoPlayer? = null
    private var restoreInProgress = false
    private var persistenceJob: Job? = null
    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val preferences by lazy {
        getSharedPreferences("sonora_playback_state", Context.MODE_PRIVATE)
    }

    override fun onCreate() {
        super.onCreate()
        val player = ExoPlayer.Builder(this).build().apply {
            setAudioAttributes(AudioAttributes.DEFAULT, true)
            setHandleAudioBecomingNoisy(true)
        }
        exoPlayer = player
        mediaSession = MediaSession.Builder(this, player).build()
        player.addListener(persistenceListener)
        restoreSnapshot(player)
        persistenceJob = serviceScope.launch {
            while (isActive) {
                delay(15_000)
                if (player.mediaItemCount > 0) saveSnapshot(player)
            }
        }
    }

    private val persistenceListener = object : androidx.media3.common.Player.Listener {
        override fun onTimelineChanged(timeline: androidx.media3.common.Timeline, reason: Int) = saveIfReady()
        override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) = saveIfReady()
        override fun onIsPlayingChanged(isPlaying: Boolean) = saveIfReady()
        override fun onPlaybackStateChanged(playbackState: Int) = saveIfReady()
        override fun onShuffleModeEnabledChanged(shuffleModeEnabled: Boolean) = saveIfReady()
        override fun onRepeatModeChanged(repeatMode: Int) = saveIfReady()
    }

    private fun saveIfReady() {
        if (!restoreInProgress) exoPlayer?.let(::saveSnapshot)
    }

    private fun saveSnapshot(player: ExoPlayer) {
        if (player.mediaItemCount == 0) {
            preferences.edit().remove("snapshot").apply()
            return
        }
        val items = JSONArray()
        for (index in 0 until player.mediaItemCount) {
            val item = player.getMediaItemAt(index)
            val uri = item.localConfiguration?.uri?.toString().orEmpty()
            if (item.mediaId.isBlank() || uri.isBlank()) continue
            val metadata = item.mediaMetadata
            items.put(JSONObject()
                .put("mediaId", item.mediaId)
                .put("uri", uri)
                .put("title", metadata.title?.toString().orEmpty())
                .put("artist", metadata.artist?.toString().orEmpty())
                .put("album", metadata.albumTitle?.toString().orEmpty())
                .put("artwork", metadata.artworkUri?.toString().orEmpty()))
        }
        if (items.length() == 0) {
            preferences.edit().remove("snapshot").apply()
            return
        }
        val index = player.currentMediaItemIndex.coerceIn(0, items.length() - 1)
        val snapshot = JSONObject()
            .put("items", items)
            .put("index", index)
            .put("positionMs", player.currentPosition.coerceAtLeast(0L))
            .put("playWhenReady", player.playWhenReady)
            .put("shuffle", player.shuffleModeEnabled)
            .put("repeat", player.repeatMode)
        preferences.edit().putString("snapshot", snapshot.toString()).apply()
    }

    private fun restoreSnapshot(player: ExoPlayer) {
        val raw = preferences.getString("snapshot", null) ?: return
        try {
            val snapshot = JSONObject(raw)
            val savedItems = snapshot.optJSONArray("items") ?: return
            val mediaItems = ArrayList<MediaItem>(savedItems.length())
            for (i in 0 until savedItems.length()) {
                val entry = savedItems.optJSONObject(i) ?: continue
                val mediaId = entry.optString("mediaId")
                val uriText = entry.optString("uri")
                if (mediaId.isBlank() || uriText.isBlank()) continue
                val metadata = MediaMetadata.Builder()
                    .setTitle(entry.optString("title").ifBlank { "Unknown track" })
                    .setArtist(entry.optString("artist").ifBlank { "Unknown artist" })
                    .setAlbumTitle(entry.optString("album"))
                    .apply { entry.optString("artwork").takeIf(String::isNotBlank)?.let { setArtworkUri(Uri.parse(it)) } }
                    .build()
                mediaItems.add(MediaItem.Builder().setMediaId(mediaId).setUri(Uri.parse(uriText)).setMediaMetadata(metadata).build())
            }
            if (mediaItems.isEmpty()) return
            restoreInProgress = true
            player.shuffleModeEnabled = snapshot.optBoolean("shuffle", false)
            val repeatMode = snapshot.optInt("repeat", androidx.media3.common.Player.REPEAT_MODE_OFF)
            player.repeatMode = if (repeatMode in androidx.media3.common.Player.REPEAT_MODE_OFF..androidx.media3.common.Player.REPEAT_MODE_ALL) repeatMode else androidx.media3.common.Player.REPEAT_MODE_OFF
            val index = snapshot.optInt("index", 0).coerceIn(0, mediaItems.lastIndex)
            val position = snapshot.optLong("positionMs", 0L).coerceAtLeast(0L)
            player.setMediaItems(mediaItems, index, position)
            player.prepare()
            player.playWhenReady = snapshot.optBoolean("playWhenReady", false)
        } catch (_: Exception) {
            preferences.edit().remove("snapshot").apply()
        } finally {
            restoreInProgress = false
        }
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? = mediaSession

    override fun onDestroy() {
        exoPlayer?.let(::saveSnapshot)
        persistenceJob?.cancel()
        exoPlayer?.removeListener(persistenceListener)
        mediaSession?.release()
        exoPlayer?.release()
        exoPlayer = null
        mediaSession = null
        serviceScope.coroutineContext[kotlinx.coroutines.Job]?.cancel()
        super.onDestroy()
    }
}
