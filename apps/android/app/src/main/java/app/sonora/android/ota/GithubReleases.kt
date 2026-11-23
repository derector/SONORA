package app.sonora.android.ota

import app.sonora.android.data.SonoraApi
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException

/**
 * Reads SONORA's published Android releases straight from the public GitHub API.
 *
 * No token, no Firebase, no third-party service: the unauthenticated `releases/latest`
 * endpoint is enough, and it already excludes drafts and prereleases, which is exactly what
 * must reach a stable installation. Rate limiting (60 requests per hour per IP) is respected
 * by the caller: the check runs periodically through WorkManager, plus one explicit
 * request per tap on «Проверить обновления».
 *
 * Transport and JSON follow the existing data-layer style (plain OkHttp + org.json, see
 * [SonoraApi]); the shared client keeps the connection pool and the timeouts in one place.
 */
object GithubReleases {
    private const val LATEST_RELEASE_URL = "https://api.github.com/repos/derector/SONORA/releases/latest"

    /** GitHub rejects API calls without a User-Agent. */
    private const val USER_AGENT = "SONORA-Android"
    private val sha256Digest = Regex("sha256:([0-9a-fA-F]{64})")

    /** The release plus the payload it came from, so the cache needs no own serializer. */
    data class Response(val raw: String, val release: ReleaseInfo?)

    /**
     * @return the newest published release and the raw JSON it was parsed from; an empty
     *         payload with a null release means the repository has no published release yet.
     * @throws IOException on any network, rate-limit or API problem.
     */
    fun fetchLatest(): Response {
        val request = Request.Builder()
            .url(LATEST_RELEASE_URL)
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28")
            .header("User-Agent", USER_AGENT)
            .build()
        SonoraApi.sharedClient.newCall(request).execute().use { response ->
            val text = response.body?.string().orEmpty()
            if (response.code == 404) return Response("", null)
            if (!response.isSuccessful) throw IOException(describeFailure(response.code, text))
            return Response(text, parseRelease(text))
        }
    }

    private fun describeFailure(code: Int, text: String): String {
        val message = runCatching { JSONObject(text).optString("message") }.getOrNull().orEmpty()
        return message.ifBlank {
            when (code) {
                403, 429 -> "GitHub ограничивает частоту запросов"
                else -> "GitHub API вернул $code"
            }
        }
    }

    /**
     * Maps the release payload onto [ReleaseInfo]. The JSON stays in this file: OtaCore only
     * ever sees plain strings and numbers, which keeps it free of Android and testable.
     * Returns null for a draft or a payload without a tag.
     */
    fun parseRelease(json: String): ReleaseInfo? {
        val payload = runCatching { JSONObject(json) }.getOrNull() ?: return null
        val tag = payload.optString("tag_name").trim()
        if (tag.isBlank() || payload.optBoolean("draft", false)) return null
        return ReleaseInfo(
            tagName = tag,
            version = parseVersion(tag),
            title = payload.optString("name").trim().ifBlank { "SONORA $tag" },
            notes = payload.optString("body"),
            publishedAt = payload.optString("published_at"),
            assets = parseAssets(payload.optJSONArray("assets"))
        )
    }

    private fun parseAssets(array: JSONArray?): List<ReleaseAsset> {
        if (array == null) return emptyList()
        val result = ArrayList<ReleaseAsset>(array.length())
        for (index in 0 until array.length()) {
            val asset = array.optJSONObject(index) ?: continue
            val url = asset.optString("browser_download_url").trim()
            val name = asset.optString("name").trim()
            // The manifest forbids cleartext traffic and an APK over http is unacceptable in
            // any case, so a non-https download URL is simply not an offer.
            if (!url.startsWith("https://")) continue
            result += ReleaseAsset(
                name = name.ifBlank { url.substringAfterLast('/') },
                url = url,
                size = asset.optLong("size"),
                sha256 = sha256Digest.matchEntire(asset.optString("digest"))?.groupValues?.get(1)
            )
        }
        return result
    }
}
