package app.sonora.android.ota

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.ForegroundInfo
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import androidx.core.content.pm.PackageInfoCompat
import app.sonora.android.BuildConfig
import app.sonora.android.data.SonoraApi
import app.sonora.android.download.TrackDownloadWorker
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.Request
import java.io.File
import java.io.FileOutputStream
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

/**
 * The decisions of the update flow: when it looks, what "newer" means for this build, and
 * how a download is (re)started.
 *
 * [check] is shared by the background worker and the manual «Проверить обновления» row, so
 * both agree on the answer and both leave the same trail in "ota_prefs".
 */
object OtaUpdate {
    const val UNIQUE_PERIODIC_CHECK = "sonora-release-check"
    const val UNIQUE_STARTUP_CHECK = "sonora-release-check-startup"
    const val UNIQUE_DOWNLOAD = "sonora-update-download"

    private const val CHECK_PERIOD_HOURS = 12L
    private const val STARTUP_DELAY_SECONDS = 25L

    sealed interface CheckResult {
        /** GitHub answered and nothing is newer than this build. */
        data object UpToDate : CheckResult

        /** A newer release exists and the user has not dismissed it. */
        data class UpdateAvailable(val release: ReleaseInfo) : CheckResult

        /** A newer release exists, but the user already answered «Не сейчас». */
        data class Dismissed(val release: ReleaseInfo) : CheckResult

        /** Network, rate limit, or a release without an installable APK. */
        data class Failed(val reason: String) : CheckResult
    }

    /**
     * Registers the background schedule: a 12-hour lookup over an unmetered connection plus
     * one quick pass shortly after a cold start.
     *
     * KEEP on both: relaunching the app must never stack checks, and the unauthenticated
     * GitHub quota (60 requests per hour and IP) plus exponential backoff keeps the periodic
     * work far from it. The startup pass uses CONNECTED because a user who just opened the
     * app on mobile data should still be told about a fix; it is one request per cold start.
     */
    fun schedule(context: Context) {
        val workManager = WorkManager.getInstance(context)
        workManager.enqueueUniquePeriodicWork(
            UNIQUE_PERIODIC_CHECK,
            ExistingPeriodicWorkPolicy.KEEP,
            PeriodicWorkRequestBuilder<ReleaseCheckWorker>(CHECK_PERIOD_HOURS, TimeUnit.HOURS)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.UNMETERED).build())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.MINUTES)
                .build()
        )
        workManager.enqueueUniqueWork(
            UNIQUE_STARTUP_CHECK,
            ExistingWorkPolicy.KEEP,
            OneTimeWorkRequestBuilder<ReleaseCheckWorker>()
                .setInitialDelay(STARTUP_DELAY_SECONDS, TimeUnit.SECONDS)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 10, TimeUnit.MINUTES)
                .build()
        )
    }

    /**
     * One release lookup against the running build.
     *
     * @param notify true for the background caller, which posts the system notification when
     *        an update is available (and silently stores it when notifications are off, so the
     *        Настройки badge still appears). The in-app caller passes false and opens the
     *        UpdateSheet itself instead.
     */
    suspend fun check(context: Context, notify: Boolean): CheckResult = withContext(Dispatchers.IO) {
        val fetched = runCatching { GithubReleases.fetchLatest() }
        if (fetched.isFailure) {
            val reason = fetched.exceptionOrNull()?.let { it.message ?: it.javaClass.simpleName }
                ?: "Не удалось связаться с GitHub"
            OtaPreferences.rememberCheck(context, null, null)
            return@withContext CheckResult.Failed(reason)
        }
        val response = fetched.getOrThrow()
        val release = response.release
        OtaPreferences.rememberCheck(context, release, response.raw)
        if (release == null) {
            // A blank payload is the documented GitHub 404: there is no published release.
            // Remove the previous offer and its ready APK so an older release cannot linger
            // in Settings or be reused by a notification after the release disappears.
            if (response.raw.isBlank()) {
                // Stop an in-flight worker before dropping its release metadata. The worker
                // also re-checks the tag before publishing its completed APK to close the
                // cancellation race.
                cancelDownload(context)
                OtaPreferences.forgetRelease(context)
                OtaPreferences.clearReadyApk(context)
                return@withContext CheckResult.UpToDate
            }
            // A non-empty but unparseable response is not proof that no release exists.
            // Preserve the last known good offer and surface a parse error instead.
            return@withContext CheckResult.Failed("Не удалось распознать опубликованный релиз GitHub")
        }
        if (release.apk == null) {
            return@withContext CheckResult.Failed("В релизе ${release.versionLabel} нет установочного APK")
        }
        if (!release.isNewerThan(BuildConfig.VERSION_NAME, BuildConfig.VERSION_CODE)) {
            forgetIfObsolete(context)
            return@withContext CheckResult.UpToDate
        }
        if (OtaPreferences.isDismissed(context, release.tagName)) return@withContext CheckResult.Dismissed(release)
        if (notify) OtaNotifications.postUpdateAvailable(context, release)
        CheckResult.UpdateAvailable(release)
    }

    /**
     * The release the Настройки badge and the notification-opened sheet should show: the
     * stored answer of the last successful check, re-validated against this build so an
     * installed update can never leave a stale badge behind.
     */
    fun availableRelease(context: Context): ReleaseInfo? {
        val cached = OtaPreferences.cachedRelease(context) ?: return null
        if (cached.apk == null ||
            !cached.isNewerThan(BuildConfig.VERSION_NAME, BuildConfig.VERSION_CODE) ||
            OtaPreferences.isDismissed(context, cached.tagName)
        ) {
            forgetIfObsolete(context)
            return null
        }
        return cached
    }

    /** Drops the stored release once it is no longer an offer. */
    fun forgetIfObsolete(context: Context) {
        val cached = OtaPreferences.cachedRelease(context) ?: return
        if (cached.isNewerThan(BuildConfig.VERSION_NAME, BuildConfig.VERSION_CODE)) return
        OtaPreferences.forgetRelease(context)
    }

    /**
     * Re-validates a cached APK immediately before every installer launch.
     *
     * WorkManager keeps the last successful output after completion. Without this second
     * check, a file prepared for an older release can be reused after GitHub has advertised
     * a newer tag. The saved tag, cached latest release, APK manifest and installed build
     * must all agree before the Android package installer is opened.
     */
    fun validateReadyApk(context: Context, apk: File): String? {
        if (!apk.isFile) return "Файл обновления не найден"

        val registeredFile = OtaPreferences.readyApkFile(context)
            ?: return "У APK отсутствует подтверждённая запись загрузки"
        val sameFile = runCatching {
            registeredFile.canonicalFile == apk.canonicalFile
        }.getOrDefault(false)
        if (!sameFile) return "Подготовлен другой файл обновления"

        val readyTag = OtaPreferences.readyApkTag(context)?.trim().orEmpty()
        if (readyTag.isBlank()) return "Не удалось определить версию скачанного APK"

        val latestRelease = OtaPreferences.cachedRelease(context)
            ?: return "Не удалось подтвердить текущий релиз"
        if (latestRelease.tagName != readyTag) {
            return "Скачанный APK относится к ${readyTag.removePrefix("v")}, а доступен релиз ${latestRelease.versionLabel}"
        }

        val archiveInfo = context.packageManager.getPackageArchiveInfo(
            apk.absolutePath,
            android.content.pm.PackageManager.GET_META_DATA
        ) ?: return "Не удалось прочитать версию скачанного APK"
        if (archiveInfo.packageName != context.packageName) {
            return "Скачанный файл не является приложением SONORA"
        }

        val expectedVersion = parseVersion(readyTag)
        val actualVersion = parseVersion(archiveInfo.versionName)
        if (expectedVersion == null || actualVersion != expectedVersion) {
            return "Версия APK не совпадает с релизом ${latestRelease.versionLabel}"
        }

        val downloadedCode = PackageInfoCompat.getLongVersionCode(archiveInfo)
        val installedInfo = runCatching {
            context.packageManager.getPackageInfo(context.packageName, 0)
        }.getOrNull() ?: return "Не удалось проверить установленную версию SONORA"
        val installedCode = PackageInfoCompat.getLongVersionCode(installedInfo)
        if (downloadedCode <= installedCode) {
            return "Этот APK не новее уже установленной версии"
        }
        return null
    }
    /** Millis of the last completed check attempt, for the «Последняя проверка» line. */
    fun lastCheckedAt(context: Context): Long = OtaPreferences.lastCheckedAt(context)

    /**
     * Starts, or restarts, the APK download.
     *
     * REPLACE cancels the running attempt when the user restarts a download.
     */
    fun startDownload(context: Context, release: ReleaseInfo) {
        val asset = release.apk ?: return
        val request = OneTimeWorkRequestBuilder<UpdateDownloadWorker>()
            .setInputData(workDataOf(
                "url" to asset.url,
                "tag" to release.tagName,
                "version" to release.versionLabel,
                "expectedBytes" to asset.size,
                "sha256" to asset.sha256
            ))
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setBackoffCriteria(BackoffPolicy.LINEAR, 30, TimeUnit.SECONDS)
            .build()
        // Persist the exact request ID before enqueueing; the UI must never infer the
        // current attempt from WorkManager's unordered list of historical work items.
        OtaPreferences.rememberCurrentDownload(context, request.id.toString())
        WorkManager.getInstance(context).enqueueUniqueWork(
            UNIQUE_DOWNLOAD,
            ExistingWorkPolicy.REPLACE,
            request
        )
    }

    fun cancelDownload(context: Context) {
        OtaPreferences.rememberCurrentDownload(context, null)
        WorkManager.getInstance(context).cancelUniqueWork(UNIQUE_DOWNLOAD)
    }
}

/** Background release lookup; posts the "update available" notification. */
class ReleaseCheckWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result =
        when (val outcome = OtaUpdate.check(applicationContext, notify = true)) {
            // 403/429 rate limits and transient network faults deserve a retry; after a few
            // attempts the next scheduled pass in 12 hours is the retry anyway.
            is OtaUpdate.CheckResult.Failed ->
                if (runAttemptCount < 3) Result.retry()
                else Result.failure(workDataOf(UpdateDownloadWorker.ERROR to outcome.reason))
            else -> Result.success()
        }
}

/**
 * Streams the release APK into the cache dir and reports determinate progress.
 *
 * Each attempt owns its staging and installation files. Alongside the size and ZIP checks
 * used by [TrackDownloadWorker], verify the GitHub digest when available before publishing.
 */
class UpdateDownloadWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val url = inputData.getString("url")
            ?: return@withContext Result.failure(workDataOf(ERROR to "Нет ссылки на установочный файл"))
        val tag = inputData.getString("tag").orEmpty()
        val expectedVersion = inputData.getString("version").orEmpty()
        val expectedBytes = inputData.getLong("expectedBytes", 0L)
        val expectedSha256 = inputData.getString("sha256")
        if (!url.startsWith("https://")) {
            return@withContext Result.failure(workDataOf(ERROR to "Ссылка на обновление небезопасна"))
        }

        val updateDirectory = File(applicationContext.cacheDir, "updates")
        if (!updateDirectory.isDirectory && !updateDirectory.mkdirs() && !updateDirectory.isDirectory) {
            return@withContext Result.failure(workDataOf(ERROR to "Не удалось подготовить папку обновления"))
        }
        val target = File(updateDirectory, "sonora-update-$id.apk")
        val partial = File(updateDirectory, "sonora-update-$id.part.apk")
        setForeground(foregroundInfo("Готовим загрузку обновления…", 0L, expectedBytes))

        val client = SonoraApi.sharedClient.newBuilder()
            .callTimeout(15, TimeUnit.MINUTES)
            .readTimeout(60, TimeUnit.SECONDS)
            .build()
        val request = Request.Builder().url(url).header("Accept", "application/octet-stream").build()

        try {
            client.newCall(request).execute().use { response ->
                val finalUrl = response.request.url
                if (finalUrl.scheme != "https") {
                    return@withContext Result.failure(workDataOf(ERROR to "Сервер перенаправил на небезопасный адрес"))
                }
                if (!response.isSuccessful) {
                    if (response.code == 403 || response.code == 429 || response.code >= 500) return@withContext Result.retry()
                    val reason = when (response.code) {
                        404 -> "Ссылка на обновление устарела"
                        else -> "Сервер вернул ${response.code}"
                    }
                    return@withContext Result.failure(workDataOf(ERROR to reason))
                }
                val body = response.body ?: return@withContext Result.retry()
                val declared = body.contentLength().takeIf { it > 0L } ?: expectedBytes
                if (declared <= 0L) {
                    return@withContext Result.failure(workDataOf(ERROR to "Сервер не сообщил размер файла"))
                }
                if (expectedBytes > 0L && declared != expectedBytes) {
                    return@withContext Result.failure(workDataOf(ERROR to "Размер файла не совпадает с релизом"))
                }

                var written = 0L
                var lastReported = 0L
                val digest = expectedSha256?.let { MessageDigest.getInstance("SHA-256") }
                body.byteStream().use { input ->
                    FileOutputStream(partial).use { output ->
                        val buffer = ByteArray(64 * 1024)
                        while (true) {
                            val count = input.read(buffer)
                            if (count < 0) break
                            output.write(buffer, 0, count)
                            digest?.update(buffer, 0, count)
                            written += count
                            if (written - lastReported >= 256 * 1024) {
                                lastReported = written
                                publishProgress(written, declared)
                                updateNotification("Загружаем обновление…", written, declared)
                            }
                        }
                        output.flush()
                        output.fd.sync()
                    }
                }

                if (partial.length() != declared) {
                    return@withContext Result.failure(workDataOf(ERROR to "Загрузка оборвалась, файл неполный"))
                }
                if (!isZipApk(partial)) {
                    return@withContext Result.failure(workDataOf(ERROR to "Скачанный файл не является APK"))
                }
                if (digest != null) {
                    val actualSha256 = digest.digest().joinToString("") { "%02x".format(it) }
                    if (!actualSha256.equals(expectedSha256, ignoreCase = true)) {
                        return@withContext Result.failure(workDataOf(ERROR to "SHA-256 файла не совпадает с релизом"))
                    }
                }

                // Validate the embedded APK identity and version before handing it to
                // Android's installer. This prevents a stale/wrong asset being offered.
                val archiveInfo = applicationContext.packageManager.getPackageArchiveInfo(
                    partial.absolutePath,
                    android.content.pm.PackageManager.GET_META_DATA
                )
                if (archiveInfo == null || archiveInfo.packageName != applicationContext.packageName) {
                    return@withContext Result.failure(workDataOf(ERROR to "APK не принадлежит приложению SONORA"))
                }
                val expectedTuple = parseVersion(expectedVersion)
                val actualTuple = parseVersion(archiveInfo.versionName)
                if (expectedTuple == null || actualTuple != expectedTuple) {
                    val actualVersionLabel = archiveInfo.versionName ?: "неизвестна"
                    return@withContext Result.failure(
                        workDataOf(ERROR to "Версия APK ($actualVersionLabel) не совпадает с релизом $expectedVersion")
                    )
                }
                val downloadedVersionCode = PackageInfoCompat.getLongVersionCode(archiveInfo)
                val installedInfo = applicationContext.packageManager.getPackageInfo(applicationContext.packageName, 0)
                val installedVersionCode = PackageInfoCompat.getLongVersionCode(installedInfo)
                if (downloadedVersionCode <= installedVersionCode) {
                    return@withContext Result.failure(
                        workDataOf(ERROR to "Скачан APK не новее установленной версии. Обновление отменено.")
                    )
                }

                if (!partial.renameTo(target)) {
                    return@withContext Result.failure(workDataOf(ERROR to "Не удалось сохранить файл"))
                }

                if (isStopped || !OtaPreferences.rememberReadyApk(
                        applicationContext, id.toString(), tag, url, expectedSha256, target
                    )
                ) {
                    target.delete()
                    return@withContext Result.failure(workDataOf(ERROR to "Релиз обновления больше не актуален"))
                }
                setProgress(workDataOf(PROGRESS to 100, DOWNLOADED to target.length(), TOTAL to target.length()))
                OtaNotifications.postUpdateReady(applicationContext, tag)
                Result.success(workDataOf(APK_PATH to target.absolutePath, TAG to tag, PROGRESS to 100))
            }
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            if (runAttemptCount < 2) Result.retry()
            else Result.failure(workDataOf(ERROR to "Не удалось скачать обновление. Проверь подключение"))
        } finally {
            runCatching { partial.delete() }
        }
    }

    private suspend fun publishProgress(downloaded: Long, total: Long) {
        val percent = ((downloaded * 100L) / total).toInt().coerceIn(0, 99)
        setProgress(workDataOf(PROGRESS to percent, DOWNLOADED to downloaded, TOTAL to total))
    }

    private fun updateNotification(message: String, downloaded: Long, total: Long) {
        val manager = applicationContext.getSystemService(android.app.NotificationManager::class.java)
        manager.notify(
            OtaNotifications.ID_DOWNLOAD,
            OtaNotifications.buildDownloadNotification(applicationContext, message, downloaded, total)
        )
    }

    private fun foregroundInfo(message: String, downloaded: Long, total: Long) = ForegroundInfo(
        OtaNotifications.ID_DOWNLOAD,
        OtaNotifications.buildDownloadNotification(applicationContext, message, downloaded, total)
    )

    /** An APK is a ZIP archive: the file must start with the "PK" signature. */
    private fun isZipApk(file: File): Boolean = runCatching {
        file.inputStream().use { stream ->
            val magic = ByteArray(2)
            stream.read(magic) == magic.size && magic[0] == 'P'.code.toByte() && magic[1] == 'K'.code.toByte()
        }
    }.getOrDefault(false)

    companion object {
        const val PROGRESS = "progress"
        const val DOWNLOADED = "downloadedBytes"
        const val TOTAL = "totalBytes"
        const val ERROR = "error"
        const val APK_PATH = "apkPath"
        const val TAG = "tag"
    }
}
