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
        if (provider != "Jamendo" || !url.startsWith("https://")) return@withContext Result.failure()

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

            setForeground(createForegroundInfo("Загружаем трек…"))
            val client = OkHttpClient.Builder().callTimeout(10, TimeUnit.MINUTES).build()
            client.newCall(
                Request.Builder().url(url)
                    .header("Accept", "audio/*,application/octet-stream;q=0.9")
                    .build()
            ).execute().use { response ->
                if (!response.isSuccessful) {
                    return@withContext if (response.code >= 500 || response.code == 429 || response.code == 408) Result.retry() else Result.failure()
                }
                val body = response.body ?: return@withContext Result.failure()
                val contentType = response.header("Content-Type").orEmpty().lowercase()
                if (contentType.startsWith("text/") || contentType.contains("application/json") || contentType.contains("text/html")) {
                    return@withContext Result.failure()
                }
                partialFile.delete()
                body.byteStream().use { input ->
                    partialFile.outputStream().use { output -> input.copyTo(output) }
                }
                if (!partialFile.exists() || partialFile.length() <= 0L) {
                    partialFile.delete()
                    return@withContext Result.retry()
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
                    provider = provider
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

    private fun stableFileKey(provider: String, trackId: String): String {
        val input = "${provider.trim().lowercase()}:$trackId"
        val digest = MessageDigest.getInstance("SHA-256").digest(input.toByteArray(Charsets.UTF_8))
        return digest.take(16).joinToString("") { "%02x".format(it.toInt() and 0xff) }
    }

    private fun createForegroundInfo(message: String): ForegroundInfo {
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
        return ForegroundInfo(4102, notification)
    }
}
