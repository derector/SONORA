package app.sonora.android.download

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.work.CoroutineWorker
import androidx.work.ForegroundInfo
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import app.sonora.android.R
import app.sonora.android.data.OfflineDatabase
import app.sonora.android.data.OfflineTrack
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

class TrackDownloadWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val url = inputData.getString("url") ?: return@withContext Result.failure()
        val id = inputData.getString("id") ?: return@withContext Result.failure()
        val provider = inputData.getString("provider") ?: return@withContext Result.failure()
        val providerName = provider.trim().lowercase().replaceFirstChar { it.titlecase() }
        val downloadAllowed = inputData.getBoolean("downloadAllowed", false)
        val licenseUrl = inputData.getString("licenseUrl").orEmpty()
        val allowedLicense = licenseUrl.startsWith("https://creativecommons.org/licenses/") ||
            licenseUrl.startsWith("http://creativecommons.org/licenses/") ||
            licenseUrl.startsWith("https://creativecommons.org/publicdomain/zero/") ||
            licenseUrl.startsWith("http://creativecommons.org/publicdomain/zero/")
        if (!provider.equals("Jamendo", ignoreCase = true) || !downloadAllowed ||
            !allowedLicense || !isJamendoHost(url)) return@withContext Result.failure()

        val directory = File(applicationContext.filesDir, "offline")
        if (!directory.exists() && !directory.mkdirs()) return@withContext Result.retry()
        val safeKey = stableFileKey(provider, id)
        val finalFile = File(directory, "$safeKey.audio")
        val partialFile = File(directory, "$safeKey.audio.part")
        val backupFile = File(directory, "$safeKey.audio.bak")
        val notificationId = notificationIdFor(provider, id)
        var newFinalCreated = false

        try {
            if (backupFile.exists() && !finalFile.exists()) backupFile.renameTo(finalFile)
            else if (backupFile.exists() && finalFile.exists()) backupFile.delete()

            val existingBytes = partialFile.takeIf { it.exists() }?.length() ?: 0L
            setForeground(createForegroundInfo("Подготовка загрузки…", notificationId))
            val requestBuilder = Request.Builder()
                .url(url)
                .header("Accept", "audio/mpeg, audio/*;q=0.9, application/octet-stream;q=0.8")
            if (existingBytes > 0L) requestBuilder.header("Range", "bytes=$existingBytes-")

            val client = OkHttpClient.Builder()
                .callTimeout(10, TimeUnit.MINUTES)
                .connectTimeout(20, TimeUnit.SECONDS)
                .readTimeout(60, TimeUnit.SECONDS)
                .build()
            client.newCall(requestBuilder.build()).execute().use { response ->
                // Reject redirects to hosts outside Jamendo.
                if (!isJamendoHost(response.request.url.toString())) return@withContext Result.failure()
                if (response.code == 416) {
                    partialFile.delete()
                    return@withContext Result.retry()
                }
                if (!response.isSuccessful) {
                    return@withContext if (response.code == 429 || response.code == 408 || response.code >= 500) Result.retry() else Result.failure()
                }

                val rangeHeader = response.header("Content-Range").orEmpty()
                val rangeMatch = Regex("""bytes (\d+)-(\d+)/(\d+|\*)""").matchEntire(rangeHeader)
                val rangeStart = rangeMatch?.groupValues?.getOrNull(1)?.toLongOrNull()
                val rangeEnd = rangeMatch?.groupValues?.getOrNull(2)?.toLongOrNull()
                val rangeTotal = rangeMatch?.groupValues?.getOrNull(3)?.toLongOrNull()
                if (response.code == 206) {
                    val bodyLength = response.body?.contentLength() ?: -1L
                    val validRange = rangeStart == existingBytes &&
                        rangeEnd != null && rangeEnd >= existingBytes &&
                        rangeTotal != null && rangeTotal > rangeEnd &&
                        (bodyLength < 0L || bodyLength == rangeEnd - existingBytes + 1L)
                    if (!validRange) {
                        partialFile.delete()
                        return@withContext Result.failure()
                    }
                }
                val append = existingBytes > 0L && response.code == 206
                if (existingBytes > 0L && !append) partialFile.delete()

                val body = response.body ?: return@withContext Result.retry()
                val contentType = response.header("Content-Type").orEmpty().substringBefore(";").trim().lowercase()
                if (contentType.startsWith("text/") || contentType.contains("application/json") ||
                    contentType.contains("text/html") ||
                    (contentType.isNotBlank() && !contentType.startsWith("audio/") && contentType != "application/octet-stream")) {
                    partialFile.delete()
                    return@withContext Result.failure()
                }

                val startBytes = if (append) existingBytes else 0L
                val bodyLength = body.contentLength()
                val totalBytes = if (append) rangeTotal ?: -1L else bodyLength
                var downloadedBytes = startBytes
                var lastReportedBytes = startBytes
                body.byteStream().use { input ->
                    FileOutputStream(partialFile, append).use { output ->
                        val buffer = ByteArray(32 * 1024)
                        while (true) {
                            val count = input.read(buffer)
                            if (count < 0) break
                            output.write(buffer, 0, count)
                            downloadedBytes += count
                            if (downloadedBytes - lastReportedBytes >= 256 * 1024) {
                                lastReportedBytes = downloadedBytes
                                val percent = if (totalBytes > 0L) ((downloadedBytes * 100L) / totalBytes).toInt().coerceIn(0, 99) else -1
                                setProgress(workDataOf("progress" to percent, "downloadedBytes" to downloadedBytes, "totalBytes" to totalBytes))
                                updateNotification(if (percent >= 0) "Загрузка $percent%" else "Загрузка…", notificationId)
                            }
                        }
                        output.fd.sync()
                    }
                }

                val sizeMismatch = totalBytes > 0L && partialFile.length() != totalBytes
                val invalidAudio = !partialFile.exists() || partialFile.length() <= 0L || !looksLikeMp3(partialFile)
                if (sizeMismatch || invalidAudio) {
                    partialFile.delete()
                    return@withContext if (sizeMismatch) Result.retry() else Result.failure()
                }

                backupFile.delete()
                if (finalFile.exists() && !finalFile.renameTo(backupFile)) return@withContext Result.retry()
                if (!partialFile.renameTo(finalFile)) {
                    if (backupFile.exists()) backupFile.renameTo(finalFile)
                    return@withContext Result.retry()
                }
                newFinalCreated = true

                val metadata = OfflineTrack(
                    id = id,
                    title = inputData.getString("title") ?: "Unknown track",
                    artist = inputData.getString("artist") ?: "Unknown artist",
                    artworkUrl = inputData.getString("artwork"),
                    localPath = finalFile.absolutePath,
                    durationSeconds = inputData.getInt("duration", 0),
                    provider = providerName
                )
                OfflineDatabase.get(applicationContext).offlineTracks().insert(metadata)
                backupFile.delete()
                newFinalCreated = false
                setProgress(workDataOf("progress" to 100, "downloadedBytes" to finalFile.length(), "totalBytes" to finalFile.length()))
                updateNotification("Трек сохранён офлайн", notificationId)
                Result.success()
            }
        } catch (cancelled: CancellationException) {
            // Keep a partial download for a future retry; rollback only a newly moved final file.
            if (newFinalCreated) finalFile.delete()
            if (backupFile.exists() && !finalFile.exists()) backupFile.renameTo(finalFile)
            throw cancelled
        } catch (_: Exception) {
            // Partial bytes are intentionally retained for Range-based retry.
            if (newFinalCreated) finalFile.delete()
            if (backupFile.exists() && !finalFile.exists()) backupFile.renameTo(finalFile)
            Result.retry()
        }
    }

    private fun isJamendoHost(rawUrl: String): Boolean {
        val host = rawUrl.toHttpUrlOrNull()?.host?.lowercase() ?: return false
        return host == "jamendo.com" || host.endsWith(".jamendo.com")
    }

    private fun looksLikeMp3(file: File): Boolean {
        val header = ByteArray(3)
        val size = FileInputStream(file).use { it.read(header) }
        return size >= 2 && (
            (size >= 3 && String(header, 0, 3, Charsets.US_ASCII) == "ID3") ||
            ((header[0].toInt() and 0xff) == 0xff && (header[1].toInt() and 0xe0) == 0xe0)
        )
    }

    private fun stableFileKey(provider: String, trackId: String): String {
        val input = "${provider.trim().lowercase()}:$trackId"
        val digest = MessageDigest.getInstance("SHA-256").digest(input.toByteArray(Charsets.UTF_8))
        return digest.take(16).joinToString("") { "%02x".format(it.toInt() and 0xff) }
    }

    private fun notificationIdFor(provider: String, trackId: String): Int {
        val prefix = stableFileKey(provider, trackId).take(7)
        return 10_000 + (prefix.toLong(16) % 900_000L).toInt()
    }

    private fun updateNotification(message: String, notificationId: Int) {
        val manager = applicationContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.notify(notificationId, buildNotification(message))
    }

    private fun createForegroundInfo(message: String, notificationId: Int): ForegroundInfo {
        val manager = applicationContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= 26) {
            manager.createNotificationChannel(NotificationChannel("sonora_downloads", "SONORA downloads", NotificationManager.IMPORTANCE_LOW))
        }
        return ForegroundInfo(notificationId, buildNotification(message))
    }

    private fun buildNotification(message: String): Notification {
        return NotificationCompat.Builder(applicationContext, "sonora_downloads")
            .setSmallIcon(R.drawable.ic_sonora)
            .setContentTitle("SONORA")
            .setContentText(message)
            .setOngoing(message != "Трек сохранён офлайн")
            .setOnlyAlertOnce(true)
            .build()
    }
}
