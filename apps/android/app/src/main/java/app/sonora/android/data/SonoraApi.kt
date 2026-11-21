package app.sonora.android.data

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

object SonoraApi {
    private const val BASE = "https://sonora-web-api-production.up.railway.app"
    /**
     * Bitrate the user selected in Настройки → Воспроизведение, in kbit/s (0 = server default).
     * Sent as X-Sonora-Quality on every API call so the resolver can honour it as soon as
     * API-lane adopts the parameter; the app already uses it as the ceiling for data saver.
     */
    @Volatile
    var qualityKbps: Int = 0
    private val jsonType = "application/json; charset=utf-8".toMediaType()
    private val http = OkHttpClient.Builder()
        .connectTimeout(12, TimeUnit.SECONDS)
        .readTimeout(25, TimeUnit.SECONDS)
        .build()
    /**
     * The app's single OkHttp client. Non-API callers must not open a second connection
     * pool, so they read this and derive their own timeouts with newBuilder() (which shares
     * the pool and dispatcher): currently the in-app update layer, for the GitHub release
     * lookup and for streaming the APK.
     */
    val sharedClient: OkHttpClient get() = http
    private lateinit var prefs: android.content.SharedPreferences

    fun initialize(context: Context) {
        val key = MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build()
        prefs = EncryptedSharedPreferences.create(
            context, "sonora_secure_session", key,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
        qualityKbps = runCatching { app.sonora.android.ui.SonoraPrefs.qualityKbps(context, cellular = false) }.getOrDefault(0)
    }

    private fun request(path: String, method: String = "GET", body: JSONObject? = null, authenticated: Boolean = false): JSONObject {
        fun buildRequest(): Request {
            val builder = Request.Builder().url(BASE + path).header("Accept", "application/json")
            val quality = qualityKbps
            if (quality > 0) builder.header("X-Sonora-Quality", quality.toString())
            if (body != null) builder.header("Content-Type", "application/json")
                .method(method, body.toString().toRequestBody(jsonType))
            else if (method != "GET") builder.method(method, ByteArray(0).toRequestBody(null))
            if (authenticated) {
                val token = prefs.getString("access_token", null)
                    ?: throw IOException("Please sign in to SONORA.")
                builder.header("Authorization", "Bearer $token")
            }
            return builder.build()
        }

        var response = http.newCall(buildRequest()).execute()
        if (authenticated && response.code == 401) {
            response.close()
            if (!refreshSession()) {
                throw IOException("Your SONORA session expired. Please sign in again.")
            }
            // Rebuild the request so it uses the refreshed access token.
            response = http.newCall(buildRequest()).execute()
        }

        response.use {
            it.header("Set-Cookie")?.let { cookie ->
                val value = Regex("sonora_refresh=([^;]+)").find(cookie)?.groupValues?.getOrNull(1)
                if (value != null) prefs.edit().putString("refresh_cookie", value).apply()
            }
            val text = it.body?.string().orEmpty()
            val data = if (text.isBlank()) JSONObject() else JSONObject(text)
            if (!it.isSuccessful) {
                val message = if (authenticated && it.code == 401) {
                    "Your SONORA session expired. Please sign in again."
                } else {
                    data.optString("error", "SONORA API error ${it.code}")
                }
                throw IOException(message)
            }
            return data
        }
    }

    fun requestOtp(email: String, username: String? = null, displayName: String? = null, register: Boolean) {
        val body = JSONObject().put("email", email.trim())
        val path = if (register) {
            body.put("username", username).put("displayName", displayName)
            "/api/v1/auth/register"
        } else "/api/v1/auth/login"
        request(path, "POST", body)
    }

    fun verifyOtp(email: String, code: String) {
        val result = request("/api/v1/auth/verify", "POST", JSONObject().put("email", email.trim()).put("token", code))
        val token = result.optJSONObject("session")?.optString("access_token").orEmpty()
        if (token.isBlank()) throw IOException("The server did not return a session.")
        prefs.edit().putString("access_token", token).putString("email", email.trim()).apply()
    }

    fun refreshSession(): Boolean {
        val cookie = prefs.getString("refresh_cookie", null) ?: return false
        return try {
            val body = JSONObject().toString().toRequestBody(jsonType)
            val req = Request.Builder().url("$BASE/api/v1/auth/refresh")
                .header("Cookie", "sonora_refresh=$cookie").post(body).build()
            http.newCall(req).execute().use { response ->
                response.header("Set-Cookie")?.let { header ->
                    Regex("sonora_refresh=([^;]+)").find(header)?.groupValues?.getOrNull(1)?.let {
                        prefs.edit().putString("refresh_cookie", it).apply()
                    }
                }
                if (!response.isSuccessful) return false
                val data = JSONObject(response.body?.string().orEmpty())
                val token = data.optJSONObject("session")?.optString("access_token").orEmpty()
                if (token.isBlank()) return false
                prefs.edit().putString("access_token", token).apply()
                true
            }
        } catch (_: Exception) { false }
    }

    fun restoreSession(): Boolean {
        if (prefs.getString("access_token", null).isNullOrBlank()) return false
        if (!prefs.getString("refresh_cookie", null).isNullOrBlank()) {
            if (refreshSession()) return true
        }
        return try {
            request("/api/v1/auth/me", authenticated = true)
            true
        } catch (_: Exception) {
            logout()
            false
        }
    }

    fun logout() {
        val accessToken = prefs.getString("access_token", null)
        val refreshCookie = prefs.getString("refresh_cookie", null)
        try {
            if (!accessToken.isNullOrBlank() && !refreshCookie.isNullOrBlank()) {
                val request = Request.Builder()
                    .url("$BASE/api/v1/auth/logout")
                    .header("Authorization", "Bearer $accessToken")
                    .header("Cookie", "sonora_refresh=$refreshCookie")
                    .post(ByteArray(0).toRequestBody(null))
                    .build()
                http.newCall(request).execute().use { /* Best-effort server-side sign-out. */ }
            }
        } catch (_: Exception) {
            // Always clear this device's credentials, even if the API is unreachable.
        } finally {
            prefs.edit().remove("access_token").remove("refresh_cookie").remove("email").apply()
        }
    }
    fun email(): String = prefs.getString("email", "").orEmpty()

    /** The bearer token for callers outside this object (profile endpoints). Never logged. */
    fun accessToken(): String? = prefs.getString("access_token", null)

    fun isSignedIn(): Boolean = prefs.getString("access_token", null) != null

    fun discover(provider: String): List<Track> {
        val path = when (provider) {
            "Audius" -> "/api/v1/providers/audius/tracks?sort=trending&limit=24"
            else -> "/api/v1/providers/jamendo/tracks?limit=24"
        }
        return parseTracks(request(path).optJSONArray("items"))
    }

    /**
     * Unified catalog feed for the Discover screen. Every source is requested with its
     * own ranking and the answers are interleaved by rank (first of each source, then
     * second of each source, ...), so no single source dominates and the UI never has
     * to offer or name a provider. Source names stay purely internal routing detail.
     * A source that fails is skipped; when all of them fail the first failure is
     * rethrown so the existing retry affordance keeps working unchanged.
     */
    fun discoverCatalog(): List<Track> {
        val feeds = listOf("Audius", "Jamendo").map { source -> runCatching { discover(source) } }
        val ranked = feeds.mapNotNull { feed -> feed.getOrNull()?.takeIf { it.isNotEmpty() } }
        if (ranked.isEmpty()) {
            throw feeds.firstNotNullOfOrNull { it.exceptionOrNull() }
                ?: IOException("Каталог временно недоступен")
        }
        val merged = LinkedHashMap<String, Track>()
        for (rank in 0 until ranked.maxOf { it.size }) {
            for (feed in ranked) {
                val track = feed.getOrNull(rank) ?: continue
                merged.putIfAbsent("${track.provider}:${track.id}", track)
            }
        }
        return merged.values.toList()
    }

    // Jamendo provider favorites are stored separately from UUID-based catalog tracks.
    fun getProviderFavorites(): List<Track> {
        val items = request("/api/v1/provider-favorites", authenticated = true).optJSONArray("items")
            ?: return emptyList()
        val result = mutableListOf<Track>()
        for (i in 0 until items.length()) {
            val saved = items.optJSONObject(i) ?: continue
            val providerId = saved.optString("provider_track_id")
            if (providerId.isBlank()) continue
            val fresh = runCatching { resolveTrack("jamendo", providerId) }.getOrNull()
            result += fresh ?: Track(
                id = providerId,
                providerTrackId = providerId,
                provider = "Jamendo",
                title = saved.optString("title", "Unknown track"),
                artist = saved.optString("artist_name", "Unknown artist"),
                album = saved.optString("album_name").takeIf { it.isNotBlank() && it != "null" },
                durationSeconds = saved.optInt("duration_seconds"),
                artworkUrl = saved.optString("artwork_url").takeIf { it.startsWith("https://") },
                licenseUrl = saved.optString("license_url").takeIf { it.startsWith("https://") },
                sourceUrl = saved.optString("source_url").takeIf { it.startsWith("https://") },
                playable = false
            )
        }
        return result
    }

    fun addProviderFavorite(track: Track) {
        if (!track.provider.equals("Jamendo", ignoreCase = true)) {
            // User-facing wording must not name the source; the check itself stays.
            throw IOException("Избранное с проверкой лицензии доступно не для этого трека.")
        }
        request(
            "/api/v1/provider-favorites",
            "POST",
            JSONObject().put("providerTrackId", track.providerTrackId),
            authenticated = true
        )
    }

    fun removeProviderFavorite(track: Track) {
        val id = java.net.URLEncoder.encode(track.providerTrackId, "UTF-8")
        request("/api/v1/provider-favorites/$id", "DELETE", authenticated = true)
    }

    fun getProviderHistory(): List<Track> {
        val items = request("/api/v1/provider-history?limit=50", authenticated = true).optJSONArray("items")
            ?: return emptyList()
        val result = mutableListOf<Track>()
        val seen = mutableSetOf<String>()
        for (i in 0 until items.length()) {
            val saved = items.optJSONObject(i) ?: continue
            val providerId = saved.optString("provider_track_id")
            if (providerId.isBlank() || !seen.add(providerId)) continue
            val fresh = runCatching { resolveTrack("jamendo", providerId) }.getOrNull()
            result += fresh ?: Track(
                id = providerId,
                providerTrackId = providerId,
                provider = "Jamendo",
                title = saved.optString("title", "Unknown track"),
                artist = saved.optString("artist_name", "Unknown artist"),
                album = saved.optString("album_name").takeIf { it.isNotBlank() && it != "null" },
                durationSeconds = saved.optInt("duration_seconds"),
                artworkUrl = saved.optString("artwork_url").takeIf { it.startsWith("https://") },
                licenseUrl = saved.optString("license_url").takeIf { it.startsWith("https://") },
                sourceUrl = saved.optString("source_url").takeIf { it.startsWith("https://") },
                playable = false
            )
        }
        return result
    }

    fun recordProviderHistory(track: Track, eventType: String = "play", listenedMs: Int = 0) {
        if (!track.provider.equals("Jamendo", ignoreCase = true)) return
        val license = track.licenseUrl?.takeIf {
            it.startsWith("https://creativecommons.org/") || it.startsWith("http://creativecommons.org/")
        } ?: return
        val source = track.sourceUrl?.takeIf { it.startsWith("https://www.jamendo.com/") } ?: return
        if (track.durationSeconds < 1 || track.providerTrackId.isBlank()) return
        val body = JSONObject()
            .put("providerTrackId", track.providerTrackId)
            .put("title", track.title)
            .put("artistName", track.artist)
            .put("albumName", track.album)
            .put("durationSeconds", track.durationSeconds)
            .put("artworkUrl", track.artworkUrl)
            .put("licenseUrl", license)
            .put("sourceUrl", source)
            .put("eventType", eventType)
            .put("listenedMs", listenedMs.coerceAtLeast(0))
        request("/api/v1/provider-history", "POST", body, authenticated = true)
    }

    data class Playlist(val id: String, val title: String, val description: String? = null, val trackCount: Int = 0)

    fun getPlaylists(): List<Playlist> {
        val items = request("/api/v1/playlists", authenticated = true).optJSONArray("items")
        val result = mutableListOf<Playlist>()
        if (items != null) for (i in 0 until items.length()) {
            val item = items.optJSONObject(i) ?: continue
            result += Playlist(item.optString("id"), item.optString("title"), item.optString("description").takeIf { it.isNotBlank() && it != "null" })
        }
        return result
    }

    fun createPlaylist(title: String): Playlist {
        val item = request("/api/v1/playlists", "POST", JSONObject().put("title", title.trim()), authenticated = true)
            .optJSONObject("playlist") ?: throw IOException("Playlist was not returned by the server.")
        return Playlist(item.optString("id"), item.optString("title"), item.optString("description").takeIf { it.isNotBlank() && it != "null" })
    }

    fun addTrackToPlaylist(playlistId: String, track: Track) {
        if (track.provider != "Audius" && track.provider != "Jamendo") throw IOException("This provider is not supported in playlists.")
        request(
            "/api/v1/playlists/${java.net.URLEncoder.encode(playlistId, "UTF-8")}/provider-tracks",
            "POST",
            JSONObject().put("provider", track.provider.lowercase()).put("providerTrackId", track.providerTrackId),
            authenticated = true
        )
    }

    fun removeTrackFromPlaylist(playlistId: String, track: Track) {
        val provider = track.provider.lowercase()
        val playlist = java.net.URLEncoder.encode(playlistId, "UTF-8")
        val providerId = java.net.URLEncoder.encode(track.providerTrackId, "UTF-8")
        request("/api/v1/playlists/$playlist/provider-tracks/$provider/$providerId", "DELETE", authenticated = true)
    }

    fun deletePlaylist(playlistId: String) {
        val id = java.net.URLEncoder.encode(playlistId, "UTF-8")
        request("/api/v1/playlists/$id", "DELETE", authenticated = true)
    }

    fun getPlaylistTracks(playlistId: String): List<Track> {
        val playlist = request("/api/v1/playlists/${java.net.URLEncoder.encode(playlistId, "UTF-8")}", authenticated = true)
            .optJSONObject("playlist") ?: return emptyList()
        val items = playlist.optJSONArray("provider_playlist_tracks") ?: return emptyList()
        val resolved = mutableListOf<Track>()
        for (i in 0 until items.length()) {
            val saved = items.optJSONObject(i) ?: continue
            val provider = saved.optString("provider")
            val providerId = saved.optString("provider_track_id")
            val path = when (provider) {
                "audius" -> "/api/v1/providers/audius/tracks?id=${java.net.URLEncoder.encode(providerId, "UTF-8")}"
                "jamendo" -> "/api/v1/providers/jamendo/tracks?id=${java.net.URLEncoder.encode(providerId, "UTF-8")}"
                else -> continue
            }
            try {
                val fresh = parseTracks(request(path).optJSONArray("items")).firstOrNull()
                if (fresh != null && fresh.playable) resolved += fresh
            } catch (_: Exception) { }
        }
        return resolved
    }

    fun resolveTrack(provider: String, providerTrackId: String): Track? {
        val encodedId = java.net.URLEncoder.encode(providerTrackId, "UTF-8")
        val path = when (provider.lowercase()) {
            "audius" -> "/api/v1/providers/audius/tracks?id=$encodedId"
            "jamendo" -> "/api/v1/providers/jamendo/tracks?id=$encodedId"
            else -> return null
        }
        return parseTracks(request(path).optJSONArray("items"))
            .firstOrNull { it.providerTrackId == providerTrackId || it.id == providerTrackId }
    }

    data class CatalogMatch(
        val id: String,
        val provider: String,
        val title: String,
        val artist: String,
        val isrc: String?,
        val durationSeconds: Int?
    )
    data class MusicSearch(
        val tracks: List<Track> = emptyList(),
        val matches: List<CatalogMatch> = emptyList(),
        val artists: List<CatalogArtist> = emptyList(),
        val searched: Boolean = false
    )
    data class CatalogArtist(val id: String, val name: String, val handle: String, val trackCount: Int?)

    fun search(query: String): MusicSearch {
        val result = request("/api/v1/search/music?q=${java.net.URLEncoder.encode(query, "UTF-8")}&type=tracks&limit=20&inApp=true")
        val metadata = result.optJSONArray("metadata")
        val matches = buildList {
            if (metadata == null) return@buildList
            for (index in 0 until metadata.length()) {
                val item = metadata.optJSONObject(index) ?: continue
                val id = item.optString("id")
                val title = item.optString("title")
                val provider = item.optString("provider")
                if (id.isBlank() || title.isBlank() || provider != "MusicBrainz") continue
                val isrc = item.optString("isrc").takeIf { it.isNotBlank() && it != "null" }
                val duration = item.optInt("durationSeconds").takeIf { it > 0 }
                add(CatalogMatch(id, provider, title, item.optString("artist"), isrc, duration))
            }
        }
        val catalogArtists = result.optJSONArray("artists")
        val artists = buildList {
            if (catalogArtists == null) return@buildList
            for (index in 0 until catalogArtists.length()) {
                val item = catalogArtists.optJSONObject(index) ?: continue
                val id = item.optString("id")
                val name = item.optString("name")
                val handle = item.optString("handle").takeIf { it.isNotBlank() && it != "null" }
                if (id.isBlank() || name.isBlank() || item.optString("provider") != "Audius") continue
                add(CatalogArtist(id, name, handle ?: name, item.optInt("trackCount", -1).takeIf { it >= 0 }))
            }
        }
        return MusicSearch(parseTracks(result.optJSONArray("tracks")).filter { it.playable }, matches, artists, searched = true)
    }

    fun findPlayableVersion(match: CatalogMatch): Track? {
        val body = JSONObject()
            .put("title", match.title)
            .put("artist", match.artist)
            .put("isrc", match.isrc)
            .put("durationSeconds", match.durationSeconds)
            .put("playbackOnly", true)
        val result = request("/api/v1/discovery/resolve", method = "POST", body = body)
        val candidate = result.optJSONObject("playableTrack") ?: return null
        return parseTracks(org.json.JSONArray().put(candidate)).firstOrNull { it.playable }
    }

    private fun parseTracks(array: org.json.JSONArray?): List<Track> {
        val tracks = mutableListOf<Track>()
        if (array == null) return tracks
        for (i in 0 until array.length()) {
            val item = array.optJSONObject(i) ?: continue
            // Cleartext guard. AndroidManifest sets usesCleartextTraffic="false", so a
            // plain http:// stream URL handed to Media3 is rejected by the platform and
            // the player stalls with no visible error. Only an https:// URL counts as a
            // deliverable source. No http->https rewrite is attempted for audio: providers
            // that publish a cleartext stream normally do not serve the same path over TLS,
            // so rewriting would only move the failure from parse time to playback time.
            val audioUrl = secureAudioUrl(item.optString("audioUrl"))
            tracks += Track(
                id = item.optString("id"),
                providerTrackId = item.optString("providerTrackId", item.optString("id")),
                provider = item.optString("provider", "Jamendo"),
                title = item.optString("title", "Unknown track"),
                artist = item.optString("artist", "Unknown artist"),
                album = item.optString("album").takeIf { it.isNotBlank() && it != "null" },
                durationSeconds = item.optInt("durationSeconds"),
                artworkUrl = httpsOrFallback(item.optString("artworkUrl")),
                audioUrl = audioUrl,
                // Offline copies are fetched by OkHttp inside this app, so a cleartext
                // download URL can never succeed either; dropping it hides the offline
                // action instead of queueing a doomed download.
                downloadUrl = secureDownloadUrl(item.optString("downloadUrl")),
                // licenseUrl and sourceUrl are attribution links, never fetched by the
                // player, so they keep their original value (including the cleartext
                // creativecommons.org form that recordProviderHistory() still accepts).
                licenseUrl = item.optString("licenseUrl").takeIf { it.startsWith("http") },
                sourceUrl = item.optString("sourceUrl").takeIf { it.startsWith("http") },
                // The track keeps all of its metadata but is reported through the existing
                // availability flag, so every screen shows it as unavailable instead of
                // starting a playback attempt that can never succeed.
                playable = audioUrl != null && item.optBoolean("playable", true)
            )
        }
        return tracks
    }

    /**
     * Playable audio must be published over TLS because the manifest disables cleartext
     * traffic. Anything else (cleartext http, a relative path, an empty string) yields
     * null, which in turn leaves the track marked as non-playable.
     */
    private fun secureAudioUrl(raw: String?): String? =
        raw?.takeIf { it.isNotBlank() && it.startsWith("https://", ignoreCase = true) }

    /**
     * Offline copies are downloaded by OkHttp under the same cleartext restriction, and
     * TrackDownloadWorker only accepts an https URL anyway, so a cleartext download link
     * is dropped rather than rewritten.
     */
    private fun secureDownloadUrl(raw: String?): String? =
        raw?.takeIf { it.startsWith("https://", ignoreCase = true) }

    /**
     * Artwork is upgraded to https when the provider only publishes the cleartext form of
     * the same image path; anything that is not an absolute http(s) URL becomes null so the
     * UI falls back to its placeholder instead of issuing a request the platform blocks.
     */
    private fun httpsOrFallback(raw: String?): String? {
        val value = raw?.trim().orEmpty()
        return when {
            value.startsWith("https://", ignoreCase = true) -> value
            value.startsWith("http://", ignoreCase = true) -> "https://" + value.substring("http://".length)
            else -> null
        }
    }
}
