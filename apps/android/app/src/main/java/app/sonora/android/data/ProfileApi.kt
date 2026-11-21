package app.sonora.android.data

import android.util.Base64
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject

/**
 * Account endpoints for the profile surface, following docs/PROFILE_CENTER_API.md
 * (`GET/PATCH /api/v1/profile`, `POST /api/v1/profile/avatar`, privacy + notification
 * blocks inside the same PATCH).
 *
 * Everything here is deliberately best-effort: the API lane is still landing these routes.
 * A `null`/`false` return is not an error the user is shown — the caller keeps the locally
 * cached value and labels it as stored on the device, so the screen never blocks on a
 * missing endpoint and never claims a sync that did not happen.
 */
object ProfileApi {
    private const val BASE = "https://sonora-web-api-production.up.railway.app"
    private val jsonType = "application/json; charset=utf-8".toMediaType()

    data class Profile(
        val displayName: String?,
        val username: String?,
        val email: String?,
        val avatarUrl: String?,
        val createdAt: String?,
        val favorites: Int?,
        val playlists: Int?,
        val history: Int?,
        val followers: Int?,
        val following: Int?
    )

    private fun JSONObject.text(vararg names: String): String? =
        names.firstNotNullOfOrNull { name -> optString(name, "").takeIf { it.isNotBlank() } }

    private fun JSONObject.number(vararg names: String): Int? =
        names.firstNotNullOfOrNull { name ->
            if (has(name) && !isNull(name)) optInt(name).takeIf { it >= 0 } else null
        }

    private fun call(path: String, method: String, body: JSONObject?): JSONObject? {
        val token = SonoraApi.accessToken() ?: return null
        val builder = Request.Builder()
            .url(BASE + path)
            .header("Accept", "application/json")
            .header("Authorization", "Bearer $token")
        if (body != null) {
            builder.method(method, body.toString().toRequestBody(jsonType))
        } else if (method != "GET") {
            builder.method(method, ByteArray(0).toRequestBody(null))
        }
        return runCatching {
            SonoraApi.sharedClient.newCall(builder.build()).execute().use { response ->
                if (!response.isSuccessful) return null
                JSONObject(response.body?.string().orEmpty())
            }
        }.getOrNull()
    }

    /**
     * Reads the profile. `/profile` is the contract route; `/auth/me` is the fallback the
     * session layer already uses, so the header can show a real name and e-mail as soon as
     * a user is signed in, even before the profile service exists.
     */
    fun fetch(): Profile? {
        val data = call("/api/v1/profile", "GET", null)
            ?: call("/api/v1/auth/me", "GET", null)
            ?: return null
        val profile = data.optJSONObject("profile") ?: data.optJSONObject("user") ?: data
        val stats = profile.optJSONObject("stats") ?: profile.optJSONObject("counts") ?: JSONObject()
        return Profile(
            displayName = profile.text("displayName", "display_name", "name"),
            username = profile.text("username", "handle"),
            email = profile.text("email"),
            avatarUrl = profile.text("avatarUrl", "avatar_url", "avatar"),
            createdAt = profile.text("createdAt", "created_at", "registeredAt"),
            favorites = stats.number("favorites", "favoriteTracks", "liked"),
            playlists = stats.number("playlists", "publicPlaylists"),
            history = stats.number("history", "listenMinutes", "plays"),
            followers = stats.number("followers"),
            following = stats.number("following")
        )
    }

    fun update(displayName: String?, username: String?): Boolean {
        val body = JSONObject()
        if (!displayName.isNullOrBlank()) body.put("displayName", displayName.trim())
        if (!username.isNullOrBlank()) body.put("username", username.trim().removePrefix("@"))
        if (body.length() == 0) return false
        return call("/api/v1/profile", "PATCH", body) != null
    }

    fun pushPrivacy(followersVisible: Boolean, playlistsVisible: Boolean, historyVisible: Boolean): Boolean {
        val body = JSONObject().put(
            "privacy",
            JSONObject()
                .put("showFollowers", followersVisible)
                .put("showPlaylists", playlistsVisible)
                .put("showHistory", historyVisible)
        )
        return call("/api/v1/profile", "PATCH", body) != null
    }

    fun pushNotifications(emailsEnabled: Boolean): Boolean {
        val body = JSONObject().put(
            "preferences",
            JSONObject().put("emailNotifications", emailsEnabled)
        )
        return call("/api/v1/profile", "PATCH", body) != null
    }

    /**
     * Uploads a downscaled JPEG using the API's JSON/base64 contract and returns the stored URL.
     * The local copy remains available offline if the remote upload fails.
     */
    fun uploadAvatar(jpeg: ByteArray): String? {
        val body = JSONObject()
            .put("contentType", "image/jpeg")
            .put("base64", Base64.encodeToString(jpeg, Base64.NO_WRAP))
        val data = call("/api/v1/profile/avatar", "POST", body) ?: return null
        val profile = data.optJSONObject("user")
            ?: data.optJSONObject("profile")
            ?: data
        return profile.text("avatarUrl", "avatar_url", "url")
    }
}
