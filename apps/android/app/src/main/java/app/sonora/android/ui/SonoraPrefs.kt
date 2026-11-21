package app.sonora.android.ui

import android.content.Context
import android.content.SharedPreferences

/**
 * Non-secret user preferences for the settings surface.
 *
 * Kept deliberately separate from `sonora_secure_session` (EncryptedSharedPreferences, owned
 * by the API layer) and from `ota_prefs` (owned by the update layer): nothing in here is
 * sensitive, and both of those files have their own lifecycle.
 *
 * Every key below is read where the behaviour is implemented, not only where the switch is
 * drawn — see the `SonoraPrefs.` call sites in MainActivity, TrackRow and TrackDownloadWorker.
 */
object SonoraPrefs {
    private const val FILE = "sonora_ui_prefs"

    // Playback
    const val NON_STOP = "non_stop_playback"
    const val QUALITY_WIFI = "quality_wifi"
    const val QUALITY_CELLULAR = "quality_cellular"

    // Offline & traffic
    const val DATA_SAVER = "data_saver"
    const val DOWNLOAD_ON_CELLULAR = "download_on_cellular"

    // Notifications
    const val NOTIFY_UPDATES = "notify_updates"
    const val NOTIFY_EMAILS = "notify_emails"

    // Appearance
    const val MOTION_ENABLED = "motion_enabled"

    // Profile privacy (UI contract of docs/PROFILE_CENTER_API.md, mirrored locally until
    // the server accepts them; see ProfileApi).
    const val PRIVACY_FOLLOWERS = "privacy_followers"
    const val PRIVACY_PLAYLISTS = "privacy_playlists"
    const val PRIVACY_HISTORY = "privacy_history"

    // Profile cache (values also live server-side; these keep the header instant offline)
    const val DISPLAY_NAME = "profile_display_name"
    const val USERNAME = "profile_username"
    const val AVATAR_PATH = "profile_avatar_path"

    fun prefs(context: Context): SharedPreferences =
        context.applicationContext.getSharedPreferences(FILE, Context.MODE_PRIVATE)

    fun bool(context: Context, key: String, default: Boolean): Boolean =
        prefs(context).getBoolean(key, default)

    fun setBool(context: Context, key: String, value: Boolean) {
        prefs(context).edit().putBoolean(key, value).apply()
    }

    fun int(context: Context, key: String, default: Int): Int =
        prefs(context).getInt(key, default)

    fun setInt(context: Context, key: String, value: Int) {
        prefs(context).edit().putInt(key, value).apply()
    }

    fun string(context: Context, key: String): String =
        prefs(context).getString(key, "").orEmpty()

    fun setString(context: Context, key: String, value: String) {
        prefs(context).edit().putString(key, value).apply()
    }

    /** Bitrate the app asks the API for in a given network class. 0 means "server default". */
    fun qualityKbps(context: Context, cellular: Boolean): Int {
        val fallback = if (cellular) QUALITY_CELLULAR else QUALITY_WIFI
        val saver = bool(context, DATA_SAVER, false)
        val configured = int(context, fallback, if (cellular) 96 else 160)
        // Data saver is the hard ceiling: it can only ever lower the chosen bitrate.
        return if (saver) minOf(configured, 96) else configured
    }

    fun qualityLabel(kbps: Int): String = when {
        kbps <= 0 -> "Как на сервере"
        kbps <= 96 -> "Экономия · 96 кбит/с"
        kbps <= 160 -> "Стандарт · 160 кбит/с"
        else -> "Максимум · 320 кбит/с"
    }

    /** Approximate size of everything the app caches on this device, in bytes. */
    fun cacheSizeBytes(context: Context): Long {
        val app = context.applicationContext
        fun sizeOf(file: java.io.File): Long = when {
            !file.exists() -> 0L
            file.isDirectory -> file.listFiles()?.sumOf(::sizeOf) ?: 0L
            else -> file.length()
        }
        val external = app.getExternalFilesDir(null)
        val database = runCatching { app.getDatabasePath("sonora-offline.db") }.getOrNull()
        return sizeOf(app.cacheDir) + sizeOf(app.filesDir) +
            (external?.let { sizeOf(it) } ?: 0L) + (database?.let { sizeOf(it) } ?: 0L)
    }

    /** Human-readable cache/size value for the settings list. */
    fun formatBytes(bytes: Long): String {
        val kb = 1024.0
        val mb = kb * 1024.0
        val gb = mb * 1024.0
        return when {
            bytes >= gb -> String.format(java.util.Locale.getDefault(), "%.2f ГБ", bytes / gb)
            bytes >= mb -> String.format(java.util.Locale.getDefault(), "%.1f МБ", bytes / mb)
            bytes >= kb -> String.format(java.util.Locale.getDefault(), "%.0f КБ", bytes / kb)
            else -> "$bytes Б"
        }
    }
}
