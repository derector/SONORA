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
    private val jsonType = "application/json; charset=utf-8".toMediaType()
    private val http = OkHttpClient.Builder()
        .connectTimeout(12, TimeUnit.SECONDS)
        .readTimeout(25, TimeUnit.SECONDS)
        .build()
    private lateinit var prefs: android.content.SharedPreferences

    fun initialize(context: Context) {
        val key = MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build()
        prefs = EncryptedSharedPreferences.create(
            context, "sonora_secure_session", key,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
    }

    private fun request(path: String, method: String = "GET", body: JSONObject? = null, authenticated: Boolean = false): JSONObject {
        fun buildRequest(): Request {
            val builder = Request.Builder().url(BASE + path).header("Accept", "application/json")
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
    fun isSignedIn(): Boolean = prefs.getString("access_token", null) != null

    fun discover(provider: String): List<Track> {
        val path = when (provider) {
            "Audius" -> "/api/v1/providers/audius/tracks?sort=trending&limit=24"
            else -> "/api/v1/providers/jamendo/tracks?limit=24"
        }
        return parseTracks(request(path).optJSONArray("items"))
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
            throw IOException("Пока избранное с проверкой лицензии доступно для Jamendo.")
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

    fun search(query: String): List<Track> {
        val result = request("/api/v1/search/music?q=${java.net.URLEncoder.encode(query, "UTF-8")}&type=tracks&limit=20")
        return parseTracks(result.optJSONArray("tracks")).filter { it.playable }
    }

    private fun parseTracks(array: org.json.JSONArray?): List<Track> {
        val tracks = mutableListOf<Track>()
        if (array == null) return tracks
        for (i in 0 until array.length()) {
            val item = array.optJSONObject(i) ?: continue
            tracks += Track(
                id = item.optString("id"),
                providerTrackId = item.optString("providerTrackId", item.optString("id")),
                provider = item.optString("provider", "Jamendo"),
                title = item.optString("title", "Unknown track"),
                artist = item.optString("artist", "Unknown artist"),
                album = item.optString("album").takeIf { it.isNotBlank() && it != "null" },
                durationSeconds = item.optInt("durationSeconds"),
                artworkUrl = item.optString("artworkUrl").takeIf { it.startsWith("http") },
                audioUrl = item.optString("audioUrl").takeIf { it.startsWith("http") },
                downloadUrl = item.optString("downloadUrl").takeIf { it.startsWith("http") },
                licenseUrl = item.optString("licenseUrl").takeIf { it.startsWith("http") },
                sourceUrl = item.optString("sourceUrl").takeIf { it.startsWith("http") },
                playable = item.optBoolean("playable", item.optString("audioUrl").startsWith("http"))
            )
        }
        return tracks
    }
}
