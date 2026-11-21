package app.sonora.android.ota

import android.content.Context
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.os.Build
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
import java.util.concurrent.TimeUnit


/**
 * Checks whether Android can install [downloaded] over [installed] without uninstalling.
 * On API 28+, a single-signer APK may legitimately rotate its key when its proof-of-rotation
 * lineage contains the currently installed signer. Multi-signer APKs require an exact set.
 * API 26-27 do not expose signing lineage, so they require an exact signer set.
 */
private fun packageInfoSigningFlags(): Int =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) PackageManager.GET_SIGNING_CERTIFICATES
    else legacySigningFlag()

@Suppress("DEPRECATION")
private fun legacySigningFlag(): Int = PackageManager.GET_SIGNATURES

private fun hasCompatibleSigningCertificate(installed: PackageInfo, downloaded: PackageInfo): Boolean {
    fun sameSignerSet(left: Array<android.content.pm.Signature>?, right: Array<android.content.pm.Signature>?): Boolean {
        if (left == null || right == null || left.isEmpty() || left.size != right.size) return false
        return left.all { signer ->
            right.any { candidate -> signer.toByteArray().contentEquals(candidate.toByteArray()) }
        }
    }

    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        val installedSigning = installed.signingInfo ?: return false
        val downloadedSigning = downloaded.signingInfo ?: return false
        if (installedSigning.hasMultipleSigners || downloadedSigning.hasMultipleSigners) {
            sameSignerSet(installedSigning.apkContentsSigners, downloadedSigning.apkContentsSigners)
        } else {
            val installedCurrentSigner = installedSigning.apkContentsSigners.singleOrNull() ?: return false
            downloadedSigning.signingCertificateHistory?.any { historicalSigner ->
                installedCurrentSigner.toByteArray().contentEquals(historicalSigner.toByteArray())
            } == true
        }
    } else {
        @Suppress("DEPRECATION")
        sameSignerSet(installed.signatures, downloaded.signatures)
    }
}

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

    /** Name of the streamed APK inside the cache dir, shared by FileProvider paths xml. */
    const val APK_FILE_NAME = "sonora-update.apk"

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
            android.content.pm.PackageManager.GET_META_DATA or packageInfoSigningFlags()
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
            context.packageManager.getPackageInfo(context.packageName, signingInfoFlags())
        }.getOrNull() ?: return "Не удалось проверить установленную версию SONORA"
        val installedCode = PackageInfoCompat.getLongVersionCode(installedInfo)
        if (downloadedCode <= installedCode) {
            return "Этот APK не новее уже установленной версии"
        }
        if (!hasCompatibleSigningCertificate(installedInfo, archiveInfo)) {
            return "Подпись APK не совпадает с установленной SONORA. Установка поверх невозможна."
        }
        return null
    }
    private fun signingInfoFlags(): Int =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) PackageManager.GET_SIGNING_CERTIFICATES
        else @Suppress("DEPRECATION") PackageManager.GET_SIGNATURES

    fun apkFile(context: Context): File = File(File(context.cacheDir, "updates"), APK_FILE_NAME)

    /** Millis of the last completed check attempt, for the «Последняя проверка» line. */
    fun lastCheckedAt(context: Context): Long = OtaPreferences.lastCheckedAt(context)

    /**
     * Starts, or restarts, the APK download.
     *
     * REPLACE is deliberate: re-tapping «Обновить» cancels the running attempt and starts a
     * clean one rather than queueing a second writer onto the same temporary file.
     */
    fun startDownload(context: Context, release: ReleaseInfo) {
        val asset = release.apk ?: return
        val request = OneTimeWorkRequestBuilder<UpdateDownloadWorker>()
            .setInputData(workDataOf("url" to asset.url, "tag" to release.tagName, "version" to release.versionLabel, "expectedBytes" to asset.size))
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
 * File handling follows the precedent of [TrackDownloadWorker]: one temporary `.part`
 * file, renamed only once the payload is proven complete, deleted on every failure path.
 * GitHub's own `size` for the asset is cross-checked against Content-Length, and the first
 * bytes must be a ZIP signature, so a truncated or HTML-error answer never reaches the
 * installer.
 */
class UpdateDownloadWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val url = inputData.getString("url")
            ?: return@withContext Result.failure(workDataOf(ERROR to "Нет ссылки на установочный файл"))
        val tag = inputData.getString("tag").orEmpty()
        val expectedVersion = inputData.getString("version").orEmpty()
        val expectedBytes = inputData.getLong("expectedBytes", 0L)
        if (!url.startsWith("https://")) {
            return@withContext Result.failure(workDataOf(ERROR to "Ссылка на обновление небезопасна"))
        }

        val updateDirectory = File(applicationContext.cacheDir, "updates")
        if (!updateDirectory.exists() && !updateDirectory.mkdirs()) {
            return@withContext Result.failure(workDataOf(ERROR to "Не удалось подготовить папку обновления"))
        }
        val target = File(updateDirectory, OtaUpdate.APK_FILE_NAME)
        val partial = File(updateDirectory, "${OtaUpdate.APK_FILE_NAME}.part")
        deleteStaleApks(target, updateDirectory)
        runCatching { partial.delete() }
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
                body.byteStream().use { input ->
                    FileOutputStream(partial).use { output ->
                        val buffer = ByteArray(64 * 1024)
                        while (true) {
                            val count = input.read(buffer)
                            if (count < 0) break
                            output.write(buffer, 0, count)
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
                    partial.delete()
                    return@withContext Result.failure(workDataOf(ERROR to "Загрузка оборвалась, файл неполный"))
                }
                if (!isZipApk(partial)) {
                    partial.delete()
                    return@withContext Result.failure(workDataOf(ERROR to "Скачанный файл не является APK"))
                }

                // Validate the embedded APK identity and version before handing it to
                // Android's installer. This prevents a stale/wrong asset being offered.
                val archiveInfo = applicationContext.packageManager.getPackageArchiveInfo(
                    partial.absolutePath,
                    android.content.pm.PackageManager.GET_META_DATA or signingInfoFlags()
                )
                if (archiveInfo == null || archiveInfo.packageName != applicationContext.packageName) {
                    partial.delete()
                    return@withContext Result.failure(workDataOf(ERROR to "APK не принадлежит приложению SONORA"))
                }
                val expectedTuple = parseVersion(expectedVersion)
                val actualTuple = parseVersion(archiveInfo.versionName)
                if (expectedTuple == null || actualTuple != expectedTuple) {
                    val actualVersionLabel = archiveInfo.versionName ?: "неизвестна"
                    partial.delete()
                    return@withContext Result.failure(
                        workDataOf(ERROR to "Версия APK ($actualVersionLabel) не совпадает с релизом $expectedVersion")
                    )
                }
                val downloadedVersionCode = PackageInfoCompat.getLongVersionCode(archiveInfo)
                val installedInfo = applicationContext.packageManager.getPackageInfo(applicationContext.packageName, signingInfoFlags())
                val installedVersionCode = PackageInfoCompat.getLongVersionCode(installedInfo)
                if (downloadedVersionCode <= installedVersionCode) {
                    partial.delete()
                    return@withContext Result.failure(
                        workDataOf(ERROR to "Скачан APK не новее установленной версии. Обновление отменено.")
                    )
                }
                if (!hasCompatibleSigningCertificate(installedInfo, archiveInfo)) {
                    partial.delete()
                    return@withContext Result.failure(
                        workDataOf(ERROR to "Подпись APK не совпадает с установленной SONORA. Установка поверх невозможна.")
                    )
                }

                if (target.exists() && !target.delete()) return@withContext Result.retry()
                if (!partial.renameTo(target)) {
                    return@withContext Result.failure(workDataOf(ERROR to "Не удалось сохранить файл"))
                }

                // A release check may have invalidated this download while the bytes
                // were streaming. Never publish an APK for a release that is no longer cached.
                if (isStopped || OtaPreferences.cachedRelease(applicationContext)?.tagName != tag) {
                    target.delete()
                    return@withContext Result.failure(workDataOf(ERROR to "Релиз обновления больше не актуален"))
                }
                OtaPreferences.rememberReadyApk(applicationContext, tag, target)
                setProgress(workDataOf(PROGRESS to 100, DOWNLOADED to target.length(), TOTAL to target.length()))
                OtaNotifications.postUpdateReady(applicationContext, tag)
                Result.success(workDataOf(APK_PATH to target.absolutePath, TAG to tag, PROGRESS to 100))
            }
        } catch (cancelled: CancellationException) {
            runCatching { partial.delete() }
            throw cancelled
        } catch (_: Exception) {
            runCatching { partial.delete() }
            if (runAttemptCount < 2) Result.retry()
            else Result.failure(workDataOf(ERROR to "Не удалось скачать обновление. Проверь подключение"))
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

    /** An APK of a superseded tag would otherwise sit in the cache for good. */
    private fun deleteStaleApks(current: File, directory: File) {
        runCatching {
            directory.listFiles()?.forEach { file ->
                if (file.absolutePath != current.absolutePath &&
                    file.name.startsWith("sonora-update") &&
                    (file.name.endsWith(".apk") || file.name.endsWith(".apk.part"))
                ) file.delete()
            }
        }
    }

    companion object {
        const val PROGRESS = "progress"
        const val DOWNLOADED = "downloadedBytes"
        const val TOTAL = "totalBytes"
        const val ERROR = "error"
        const val APK_PATH = "apkPath"
        const val TAG = "tag"
    }
}
