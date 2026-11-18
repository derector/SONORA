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
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

class TrackDownloadWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val url = inputData.getString("url") ?: return@withContext Result.failure()
        val id = inputData.getString("id") ?: return@withContext Result.failure()
        val provider = inputData.getString("provider") ?: return@withContext Result.failure()
        val providerName = provider.trim().lowercase().replaceFirstChar { it.titlecase() }
        if (!provider.equals("Jamendo", ignoreCase = true) || !isJamendoHost(url)) return@withContext Result.failure()

        val directory = File(applicationContext.filesDir, "offline")
        if (!directory.exists() && !directory.mkdirs()) return@withContext Result.retry()
        val safeKey = stableFileKey(provider, id)
        val finalFile = File(directory, "$safeKey.audio")
        val partialFile = File(directory, "$safeKey.audio.part")
        val backupFile = File(directory, "$safeKey.audio.bak")
        var newFinalCreated = false

        try {
            if (backupFile.exists() && !finalFile.exists()) backupFile.renameTo(finalFile)
            else if (backupFile.exists() && finalFile.exists()) backupFile.delete()

            setForeground(createForegroundInfo("Загружаем трек…", notificationIdFor(provider, id)))
            val client = OkHttpClient.Builder().callTimeout(10, TimeUnit.MINUTES).build()
            client.newCall(
                Request.Builder().url(url)
                    .header("Accept", "audio/*,application/octet-stream;q=0.9")
                    .build()
            ).execute().use { response ->
                // Reject redirects to hosts outside the Jamendo domain.
                if (!isJamendoHost(response.request.url.toString())) return@withContext Result.failure()
                if (!response.isSuccessful) {
                    return@withContext if (response.code >= 500 || response.code == 429 || response.code == 408) Result.retry() else Result.failure()
                }
                val body = response.body ?: return@withContext Result.failure()
                val contentType = response.header("Content-Type").orEmpty().lowercase()
                if (contentType.startsWith("text/") || contentType.contains("application/json") || contentType.contains("text/html") ||
                    (contentType.isNotBlank() && !contentType.startsWith("audio/") && contentType != "application/octet-stream")) {
                    return@withContext Result.failure()
                }
                partialFile.delete()
                body.byteStream().use { input ->
                    partialFile.outputStream().use { output -> input.copyTo(output) }
                }
                if (!partialFile.exists() || partialFile.length() <= 0L ||
                    (contentType == "application/octet-stream" && !looksLikeAudio(partialFile))) {
                    partialFile.delete()
                    return@withContext Result.failure()
                }

                backupFile.delete()
                if (finalFile.exists() && !finalFile.renameTo(backupFile)) {
                    partialFile.delete()
                    return@withContext Result.retry()
                }
                if (!partialFile.renameTo(finalFile)) {
                    partialFile.delete()
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
                Result.success()
            }
        } catch (cancelled: CancellationException) {
            partialFile.delete()
            if (newFinalCreated) finalFile.delete()
            if (backupFile.exists() && !finalFile.exists()) backupFile.renameTo(finalFile)
            throw cancelled
        } catch (_: Exception) {
            partialFile.delete()
            if (newFinalCreated) finalFile.delete()
            if (backupFile.exists() && !finalFile.exists()) backupFile.renameTo(finalFile)
            Result.retry()
        }
    }

    private fun isJamendoHost(rawUrl: String): Boolean {
        val host = rawUrl.toHttpUrlOrNull()?.host?.lowercase() ?: return false
        return host == "jamendo.com" || host.endsWith(".jamendo.com")
    }

    private fun looksLikeAudio(file: File): Boolean {
        val header = ByteArray(12)
        val count = file.inputStream().use { it.read(header) }
        if (count < 4) return false
        val text = header.take(4).toByteArray().toString(Charsets.US_ASCII)
        if (text == "ID3" || text == "OggS" || text == "fLaC" || text == "RIFF" || text == "ftyp") return true
        // MPEG audio frame sync or AAC ADTS sync.
        return header[0] == 0xff.toByte() && (header[1].toInt() and 0xe0) == 0xe0
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

    private fun createForegroundInfo(message: String, notificationId: Int): ForegroundInfo {
        val manager = applicationContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= 26) {
            manager.createNotificationChannel(NotificationChannel("sonora_downloads", "SONORA downloads", NotificationManager.IMPORTANCE_LOW))
        }
        val notification: Notification = NotificationCompat.Builder(applicationContext, "sonora_downloads")
            .setSmallIcon(R.drawable.ic_sonora)
            .setContentTitle("SONORA")
            .setContentText(message)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .build()
        return ForegroundInfo(notificationId, notification)
    }
}
