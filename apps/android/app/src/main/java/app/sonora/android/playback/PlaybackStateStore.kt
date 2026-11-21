package app.sonora.android.playback

import android.content.Context
import android.net.Uri
import android.os.SystemClock
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
    // One-shot restore handoff between PlaybackService and MainActivity.
    private const val KEY_SERVICE_RESUMED = "service_resumed_at"
    private const val SERVICE_RESUMED_TTL_MS = 30_000L

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
            // Keep each surviving track's original queue index. If a downloaded
            // file was removed, filtering it must not shift the saved playhead onto
            // the following track by accident.
            val indexedTracks = ArrayList<Pair<Int, Track>>(array.length())
            for (index in 0 until array.length()) {
                val item = array.optJSONObject(index) ?: continue
                val localPath = item.optString("localPath").takeIf { it.isNotBlank() && it != "null" }
                val localFile = localPath?.let(::File)
                if (localFile != null && !localFile.isFile) continue
                indexedTracks += index to Track(
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
            if (indexedTracks.isEmpty()) return null
            val tracks = indexedTracks.map { it.second }
            val requestedIndex = state.optInt("currentIndex", 0).coerceIn(0, array.length() - 1)
            val exactTrackSurvived = indexedTracks.any { it.first == requestedIndex }
            val restoredIndex = indexedTracks.indexOfFirst { it.first >= requestedIndex }
                .takeIf { it >= 0 } ?: indexedTracks.lastIndex
            SavedPlaybackState(
                tracks = tracks,
                currentIndex = restoredIndex,
                // A playhead offset belongs to the original track only. If that
                // item disappeared, start its replacement from the beginning.
                positionMs = if (exactTrackSurvived) {
                    state.optLong("positionMs", 0L).coerceAtLeast(0L)
                } else {
                    0L
                },
                shuffleEnabled = state.optBoolean("shuffleEnabled", false),
                repeatMode = state.optInt("repeatMode", 0),
                playWhenReady = state.optBoolean("playWhenReady", false)
            )
        }.getOrNull()
    }

    /**
     * Restore ownership handoff. Media3 asks [PlaybackService] for the persisted queue
     * when a controller requests playback without a current item (media button, System
     * UI). When that resumption succeeds, the service stamps this marker so that
     * MainActivity's own restore path can see it during the same cold start and stay out
     * of the way instead of rebuilding the queue a second time.
     *
     * The marker carries the write time and is only honoured while fresh, and every read
     * removes it, so a handoff left behind by an older process can never make the
     * activity skip a restore it actually has to perform.
     */
    fun markQueueResumedByService(context: Context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().putLong(KEY_SERVICE_RESUMED, SystemClock.elapsedRealtime()).apply()
    }

    fun clearQueueResumedByService(context: Context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().remove(KEY_SERVICE_RESUMED).apply()
    }

    /** Reads and clears the handoff marker; true only when it was written recently. */
    fun consumeQueueResumedByService(context: Context): Boolean {
        val preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val resumedAt = preferences.getLong(KEY_SERVICE_RESUMED, 0L)
        if (resumedAt != 0L) preferences.edit().remove(KEY_SERVICE_RESUMED).apply()
        return resumedAt != 0L &&
            SystemClock.elapsedRealtime() - resumedAt <= SERVICE_RESUMED_TTL_MS
    }

    fun clear(context: Context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().remove(KEY_STATE).remove(KEY_SERVICE_RESUMED).apply()
    }
}
