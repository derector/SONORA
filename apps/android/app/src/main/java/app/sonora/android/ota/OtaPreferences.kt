package app.sonora.android.ota

import android.content.Context
import android.content.SharedPreferences

/**
 * The whole persistent state of the update flow, in plain (unencrypted) SharedPreferences
 * under "ota_prefs": when we last looked, which release we saw, which releases the user
 * already refused, and which downloaded APK is waiting to be installed.
 *
 * Nothing here is secret, and the values must survive a process death and be readable from
 * a worker, so this store deliberately does not use the encrypted session prefs of
 * [app.sonora.android.data.SonoraApi].
 *
 * The release itself is kept as the raw GitHub JSON: the payload is small, versioned by
 * GitHub and re-parsed on read, so no hand-written serializer has to stay in sync.
 */
object OtaPreferences {
    private const val PREFS_NAME = "ota_prefs"
    private const val KEY_LAST_CHECKED_AT = "last_checked_at"
    private const val KEY_LATEST_TAG = "latest_known_tag"
    private const val KEY_LATEST_JSON = "latest_known_json"
    private const val KEY_DISMISSED_TAGS = "dismissed_tags"
    private const val KEY_READY_TAG = "ready_apk_tag"
    private const val KEY_READY_PATH = "ready_apk_path"
    private const val KEY_CURRENT_DOWNLOAD_ID = "current_download_id"

    private fun prefs(context: Context): SharedPreferences =
        context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    /** Wall-clock millis of the last completed check attempt, 0 when never checked. */
    fun lastCheckedAt(context: Context): Long = prefs(context).getLong(KEY_LAST_CHECKED_AT, 0L)

    fun latestKnownTag(context: Context): String? = prefs(context).getString(KEY_LATEST_TAG, null)

    /** The most recently seen release, or null when nothing usable was ever stored. */
    fun cachedRelease(context: Context): ReleaseInfo? {
        val json = prefs(context).getString(KEY_LATEST_JSON, null) ?: return null
        return GithubReleases.parseRelease(json)
    }

    fun rememberCheck(context: Context, release: ReleaseInfo?, rawJson: String?) {
        prefs(context).edit()
            .putLong(KEY_LAST_CHECKED_AT, System.currentTimeMillis())
            .apply()
        if (release == null || rawJson.isNullOrBlank()) return
        prefs(context).edit()
            .putString(KEY_LATEST_TAG, release.tagName)
            .putString(KEY_LATEST_JSON, rawJson)
            .apply()
    }

    /** Drops the stored release: it is no longer an offer (installed, or gone). */
    fun forgetRelease(context: Context) {
        prefs(context).edit().remove(KEY_LATEST_TAG).remove(KEY_LATEST_JSON).apply()
    }

    /** Releases the user dismissed with «Не сейчас» are never offered again. */
    fun isDismissed(context: Context, tag: String): Boolean =
        prefs(context).getStringSet(KEY_DISMISSED_TAGS, emptySet())?.contains(tag) == true

    fun dismiss(context: Context, tag: String) {
        val current = prefs(context).getStringSet(KEY_DISMISSED_TAGS, emptySet()).orEmpty().toMutableSet()
        current += tag
        // The set only ever needs the recent refusals; an old tag can never be offered again
        // anyway, so it is dropped rather than accumulating for the life of the install.
        while (current.size > 20) current.remove(current.iterator().next())
        prefs(context).edit().putStringSet(KEY_DISMISSED_TAGS, current).apply()
    }

    /** An APK already downloaded and waiting for the system installer. */
    /**
     * The downloaded APK as a file. Callers hand it to [OtaInstaller], which turns it into a
     * FileProvider content URI; a file:// URI would be rejected by the receiving app since
     * Android 7, so none is ever stored.
     */
    fun readyApkFile(context: Context): java.io.File? {
        val path = prefs(context).getString(KEY_READY_PATH, null) ?: return null
        val file = java.io.File(path)
        val updatesDirectory = java.io.File(context.cacheDir, "updates")
        val isScopedUpdate = runCatching {
            file.canonicalFile.parentFile == updatesDirectory.canonicalFile
        }.getOrDefault(false)
        if (!file.isFile || !isScopedUpdate) {
            // Drop paths saved by older builds, which stored the APK outside the
            // FileProvider's dedicated updates directory.
            clearReadyApk(context)
            return null
        }
        return file
    }

    fun readyApkTag(context: Context): String? = prefs(context).getString(KEY_READY_TAG, null)

    @Synchronized
    fun rememberReadyApk(
        context: Context, requestId: String, tag: String, url: String, sha256: String?, file: java.io.File
    ): Boolean {
        if (currentDownloadId(context) != requestId) return false
        val release = cachedRelease(context) ?: return false
        val asset = release.apk ?: return false
        if (release.tagName != tag || asset.url != url || asset.sha256 != sha256) return false
        prefs(context).edit()
            .putString(KEY_READY_TAG, tag)
            .putString(KEY_READY_PATH, file.absolutePath)
            .apply()
        return true
    }

    /** Exact WorkManager request currently representing the selected release download. */
    fun currentDownloadId(context: Context): String? =
        prefs(context).getString(KEY_CURRENT_DOWNLOAD_ID, null)

    @Synchronized
    fun rememberCurrentDownload(context: Context, id: String?) {
        prefs(context).edit().putString(KEY_CURRENT_DOWNLOAD_ID, id).apply()
    }

    fun clearReadyApk(context: Context) {
        prefs(context).edit().remove(KEY_READY_TAG).remove(KEY_READY_PATH).apply()
    }
}
