package app.sonora.android.ota

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import app.sonora.android.MainActivity
import app.sonora.android.R
import java.io.File

/**
 * Notification channels and the two update notifications.
 *
 * "sonora_updates" is the release-availability channel: IMPORTANCE_DEFAULT, because the
 * user has to learn about a new version without the app opening a screen on its own. The
 * APK download reports on the existing "sonora_downloads" channel that
 * [app.sonora.android.download.TrackDownloadWorker] already owns, so the app keeps one
 * download channel instead of two near-identical ones.
 */
object OtaNotifications {
    const val CHANNEL_UPDATES = "sonora_updates"
    const val CHANNEL_DOWNLOADS = "sonora_downloads"

    const val ID_UPDATE_AVAILABLE = 20001
    const val ID_UPDATE_READY = 20002
    const val ID_DOWNLOAD = 20003

    fun ensureChannels(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_UPDATES, "Обновления", NotificationManager.IMPORTANCE_DEFAULT).apply {
                description = "Сообщает о новых версиях SONORA"
            }
        )
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_DOWNLOADS, "Загрузки", NotificationManager.IMPORTANCE_LOW).apply {
                description = "Прогресс загрузки треков и обновлений"
                setShowBadge(false)
            }
        )
    }

    /**
     * False when the OS would drop the notification anyway (Android 13+ runtime permission
     * or the per-app switch). Callers then store the release silently, which leaves the
     * badge in Настройках as the honest signal.
     */
    fun canPost(context: Context): Boolean {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED
        ) return false
        return NotificationManagerCompat.from(context).areNotificationsEnabled()
    }

    /** Tapping this notification opens the in-app UpdateSheet — never a browser. */
    fun postUpdateAvailable(context: Context, release: ReleaseInfo) {
        if (!canPost(context)) return
        val notification = builder(context, CHANNEL_UPDATES, "Доступно обновление SONORA")
            .setContentText("Версия ${release.versionLabel} (${release.apkSizeLabel}). Нажми, чтобы обновить в приложении.")
            .setStyle(
                NotificationCompat.BigTextStyle().bigText(
                    "Версия ${release.versionLabel}: ${chopNotes(release.notes, 200)}"
                )
            )
            .setContentIntent(openApp(context, MainActivity.ACTION_SHOW_UPDATE, release.tagName))
            .setCategory(Notification.CATEGORY_SYSTEM)
            .setAutoCancel(true)
            .build()
        runCatching { NotificationManagerCompat.from(context).notify(ID_UPDATE_AVAILABLE, notification) }
    }

    /** The APK is on disk; tapping resumes straight into the system installer. */
    fun postUpdateReady(context: Context, tag: String) {
        if (!canPost(context)) return
        val notification = builder(context, CHANNEL_UPDATES, "Обновление готово к установке")
            .setContentText("SONORA ${tag.removePrefix("v")} скачана. Нажми, чтобы продолжить установку.")
            .setContentIntent(openApp(context, MainActivity.ACTION_INSTALL_READY, tag))
            .setCategory(Notification.CATEGORY_SYSTEM)
            .setAutoCancel(true)
            .build()
        runCatching { NotificationManagerCompat.from(context).notify(ID_UPDATE_READY, notification) }
    }

    /** Ongoing determinate-progress notification used by the download worker. */
    fun buildDownloadNotification(context: Context, message: String, downloaded: Long, total: Long): Notification {
        val builder = builder(context, CHANNEL_DOWNLOADS, "Загрузка обновления")
            .setContentText(message)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(Notification.CATEGORY_PROGRESS)
        if (total <= 0L) builder.setProgress(0, 0, true)
        else builder.setProgress(100, ((downloaded * 100L) / total).toInt().coerceIn(0, 100), false)
        return builder.build()
    }

    private fun builder(context: Context, channel: String, title: String) =
        NotificationCompat.Builder(context, channel)
            .setSmallIcon(R.drawable.ic_sonora)
            .setContentTitle(title)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)

    private fun openApp(context: Context, action: String, tag: String): PendingIntent {
        val intent = Intent(context, MainActivity::class.java)
            .setAction(action)
            .putExtra(MainActivity.EXTRA_RELEASE_TAG, tag)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        return PendingIntent.getActivity(
            context, action.hashCode(), intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }
}

/**
 * Hands the downloaded APK to the system package installer.
 *
 * This is the one step that cannot happen inside SONORA: Android makes the user confirm the
 * install in the system sheet, and since Android 8 the "install unknown apps" grant lives
 * in Settings. Everything before and after it stays in-app.
 */
object OtaInstaller {
    enum class Outcome { LAUNCHED, NEEDS_PERMISSION, NO_FILE, NO_HANDLER }

    fun canInstallPackages(context: Context): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.O || context.packageManager.canRequestPackageInstalls()

    /** The only Settings screen the flow can ever open, and only for the install grant. */
    fun openUnknownSourcesSettings(context: Context) {
        val intent = Intent(
            android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
            Uri.parse("package:${context.packageName}")
        ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        runCatching { context.startActivity(intent) }
    }

    fun launch(context: Context, apk: File): Outcome {
        if (!apk.isFile) return Outcome.NO_FILE
        if (!canInstallPackages(context)) return Outcome.NEEDS_PERMISSION
        val uri = runCatching {
            FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", apk)
        }.getOrNull() ?: return Outcome.NO_FILE
        val intent = Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        return try {
            context.startActivity(intent)
            Outcome.LAUNCHED
        } catch (_: Exception) {
            Outcome.NO_HANDLER
        }
    }
}
