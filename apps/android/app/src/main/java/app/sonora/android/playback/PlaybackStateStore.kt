package app.sonora.android.playback

import android.content.Context
import android.net.Uri
import app.sonora.android.data.Track
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

data class SavedPlaybackState(
    val tracks: List<Track>,
    val currentIndex: Int,
    val positionMs: Long,
    val shuffleEnabled: Boolean,
    val repeatMode: Int,
    val playWhenReady: Boolean
)

/**
 * Persists queue identity and metadata, never expiring provider stream URLs.
 * Network tracks are resolved again through SonoraApi when the app reconnects.
 */
object PlaybackStateStore {
    private const val PREFS = "sonora_playback_state"
    private const val KEY_STATE = "queue_state"

    fun save(
        context: Context,
        queue: List<Track>,
        currentIndex: Int,
        positionMs: Long,
        shuffleEnabled: Boolean,
        repeatMode: Int,
        playWhenReady: Boolean
    ) {
        if (queue.isEmpty()) return
        val items = JSONArray()
        queue.forEach { track ->
            val audioUri = track.audioUrl?.let(Uri::parse)
            val localPath = if (audioUri?.scheme == "file") audioUri.path else null
            items.put(JSONObject()
                .put("id", track.id)
                .put("providerTrackId", track.providerTrackId)
                .put("provider", track.provider)
                .put("title", track.title)
                .put("artist", track.artist)
                .put("album", track.album ?: JSONObject.NULL)
                .put("durationSeconds", track.durationSeconds)
                .put("artworkUrl", track.artworkUrl ?: JSONObject.NULL)
                .put("localPath", localPath ?: JSONObject.NULL))
        }
        val state = JSONObject()
            .put("tracks", items)
            .put("currentIndex", currentIndex.coerceIn(0, queue.lastIndex))
            .put("positionMs", positionMs.coerceAtLeast(0L))
            .put("shuffleEnabled", shuffleEnabled)
            .put("repeatMode", repeatMode)
            .put("playWhenReady", playWhenReady)
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().putString(KEY_STATE, state.toString()).apply()
    }

    fun load(context: Context): SavedPlaybackState? {
        val raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(KEY_STATE, null) ?: return null
        return runCatching {
            val state = JSONObject(raw)
            val array = state.optJSONArray("tracks") ?: JSONArray()
            val tracks = ArrayList<Track>(array.length())
            for (index in 0 until array.length()) {
                val item = array.optJSONObject(index) ?: continue
                val localPath = item.optString("localPath").takeIf { it.isNotBlank() && it != "null" }
                val localFile = localPath?.let(::File)
                if (localFile != null && !localFile.isFile) continue
                tracks += Track(
                    id = item.optString("id"),
                    providerTrackId = item.optString("providerTrackId"),
                    provider = item.optString("provider"),
                    title = item.optString("title"),
                    artist = item.optString("artist"),
                    album = item.optString("album").takeIf { it.isNotBlank() && it != "null" },
                    durationSeconds = item.optInt("durationSeconds"),
                    artworkUrl = item.optString("artworkUrl").takeIf { it.isNotBlank() && it != "null" },
                    audioUrl = localFile?.let { Uri.fromFile(it).toString() },
                    playable = localFile?.isFile == true
                )
            }
            if (tracks.isEmpty()) return null
            SavedPlaybackState(
                tracks = tracks,
                currentIndex = state.optInt("currentIndex", 0).coerceIn(0, tracks.lastIndex),
                positionMs = state.optLong("positionMs", 0L).coerceAtLeast(0L),
                shuffleEnabled = state.optBoolean("shuffleEnabled", false),
                repeatMode = state.optInt("repeatMode", 0),
                playWhenReady = state.optBoolean("playWhenReady", false)
            )
        }.getOrNull()
    }

    fun clear(context: Context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().remove(KEY_STATE).apply()
    }
}
