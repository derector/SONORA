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
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.net.URI
import java.util.concurrent.TimeUnit

class TrackDownloadWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val url = inputData.getString("url") ?: return@withContext Result.failure()
        val id = inputData.getString("id") ?: return@withContext Result.failure()
        val provider = inputData.getString("provider") ?: return@withContext Result.failure()
        val downloadAllowed = inputData.getBoolean("downloadAllowed", false)
        val licenseUrl = inputData.getString("licenseUrl").orEmpty()
        val uri = runCatching { URI(url) }.getOrNull()
        val host = uri?.host?.lowercase().orEmpty()
        val trustedHost = host == "jamendo.com" || host.endsWith(".jamendo.com")
        val recognizedLicense = licenseUrl.startsWith("https://creativecommons.org/") ||
            licenseUrl.startsWith("http://creativecommons.org/")

        if (provider != "Jamendo" || !downloadAllowed || !recognizedLicense ||
            uri?.scheme != "https" || !trustedHost) return@withContext Result.failure()

        val safeId = "${provider}_${id}".replace(Regex("[^A-Za-z0-9_-]"), "_")
        val directory = File(applicationContext.filesDir, "offline")
        if (!directory.exists() && !directory.mkdirs()) return@withContext Result.retry()
        val finalFile = File(directory, "$safeId.audio")
        val partialFile = File(directory, "$safeId.audio.part")
        var pendingFinalFile: File? = null

        try {
            setForeground(createForegroundInfo("Подготовка загрузки…"))
            val existingBytes = partialFile.takeIf { it.exists() }?.length() ?: 0L
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
                if (response.code == 416) {
                    partialFile.delete()
                    return@withContext Result.retry()
                }
                if (!response.isSuccessful) {
                    return@withContext if (response.code == 429 || response.code >= 500) Result.retry() else Result.failure()
                }

                val append = existingBytes > 0L && response.code == 206
                if (append && !response.header("Content-Range").orEmpty().startsWith("bytes $existingBytes-")) {
                    partialFile.delete()
                    return@withContext Result.retry()
                }
                if (existingBytes > 0L && !append) partialFile.delete()

                val body = response.body ?: return@withContext Result.retry()
                val contentType = response.header("Content-Type").orEmpty().substringBefore(";").trim().lowercase()
                if (contentType.isNotBlank() && !contentType.startsWith("audio/") &&
                    contentType != "application/octet-stream") {
                    partialFile.delete()
                    return@withContext Result.failure()
                }

                val startingBytes = if (append) existingBytes else 0L
                val contentLength = body.contentLength()
                val totalBytes = if (contentLength >= 0L) startingBytes + contentLength else -1L
                var downloadedBytes = startingBytes
                var lastReportedBytes = startingBytes

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
                                val progress = if (totalBytes > 0L) ((downloadedBytes * 100L) / totalBytes).toInt().coerceIn(0, 99) else -1
                                setProgress(workDataOf("progress" to progress, "downloadedBytes" to downloadedBytes, "totalBytes" to totalBytes))
                                updateNotification(if (progress >= 0) "Загружаем трек… $progress%" else "Загружаем трек…")
                            }
                        }
                        output.fd.sync()
                    }
                }

                if (!partialFile.exists() || partialFile.length() <= 0L) return@withContext Result.retry()
                if (totalBytes > 0L && partialFile.length() != totalBytes) return@withContext Result.retry()

                val signature = ByteArray(3)
                val signatureSize = FileInputStream(partialFile).use { it.read(signature) }
                val isMp3 = signatureSize >= 2 &&
                    ((signatureSize >= 3 && String(signature, 0, 3, Charsets.US_ASCII) == "ID3") ||
                        ((signature[0].toInt() and 0xFF) == 0xFF && (signature[1].toInt() and 0xE0) == 0xE0))
                if (!isMp3) {
                    partialFile.delete()
                    return@withContext Result.failure()
                }

                if (finalFile.exists() && !finalFile.delete()) return@withContext Result.retry()
                if (!partialFile.renameTo(finalFile)) return@withContext Result.retry()
                pendingFinalFile = finalFile

                val meta = OfflineTrack(
                    id = id,
                    title = inputData.getString("title") ?: "Unknown track",
                    artist = inputData.getString("artist") ?: "Unknown artist",
                    artworkUrl = inputData.getString("artwork"),
                    localPath = finalFile.absolutePath,
                    durationSeconds = inputData.getInt("duration", 0),
                    provider = provider
                )
                OfflineDatabase.get(applicationContext).offlineTracks().insert(meta)
                pendingFinalFile = null
                setProgress(workDataOf("progress" to 100, "downloadedBytes" to finalFile.length(), "totalBytes" to finalFile.length()))
                updateNotification("Трек сохранён офлайн")
                Result.success()
            }
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            pendingFinalFile?.delete()
            Result.retry()
        }
    }

    private fun notificationId(): Int = 10000 + (inputData.getString("provider").orEmpty() + ":" + inputData.getString("id").orEmpty()).hashCode().and(0x3fffffff)\n\n    private fun updateNotification(message: String) {
        val manager = applicationContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.notify(notificationId(), buildNotification(message))
    }

    private fun createForegroundInfo(message: String): ForegroundInfo {
        val manager = applicationContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= 26) {
            manager.createNotificationChannel(NotificationChannel("sonora_downloads", "SONORA downloads", NotificationManager.IMPORTANCE_LOW))
        }
        return ForegroundInfo(notificationId(), buildNotification(message))
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
