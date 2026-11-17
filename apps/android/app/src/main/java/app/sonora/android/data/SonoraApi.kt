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
        val builder = Request.Builder().url(BASE + path).header("Accept", "application/json")
        if (body != null) builder.header("Content-Type", "application/json").method(method, body.toString().toRequestBody(jsonType))
        else if (method != "GET") builder.method(method, ByteArray(0).toRequestBody(null))
        if (authenticated) {
            val token = prefs.getString("access_token", null) ?: throw IOException("Please sign in to SONORA.")
            builder.header("Authorization", "Bearer $token")
        }
        val response = http.newCall(builder.build()).execute()
        response.use {
            it.header("Set-Cookie")?.let { cookie ->
                val value = Regex("sonora_refresh=([^;]+)").find(cookie)?.groupValues?.getOrNull(1)
                if (value != null) prefs.edit().putString("refresh_cookie", value).apply()
            }
            val text = it.body?.string().orEmpty()
            val data = if (text.isBlank()) JSONObject() else JSONObject(text)
            if (!it.isSuccessful) throw IOException(data.optString("error", "SONORA API error ${it.code}"))
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

    fun logout() { prefs.edit().remove("access_token").remove("refresh_cookie").remove("email").apply() }
    fun email(): String = prefs.getString("email", "").orEmpty()
    fun isSignedIn(): Boolean = prefs.getString("access_token", null) != null

    fun discover(provider: String): List<Track> {
        val path = when (provider) {
            "Audius" -> "/api/v1/providers/audius/tracks?sort=trending&limit=24"
            else -> "/api/v1/providers/jamendo/tracks?limit=24"
        }
        return parseTracks(request(path).optJSONArray("items"))
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
