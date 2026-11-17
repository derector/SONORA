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
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.util.concurrent.TimeUnit

class TrackDownloadWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val url = inputData.getString("url") ?: return@withContext Result.failure()
        val id = inputData.getString("id") ?: return@withContext Result.failure()
        val provider = inputData.getString("provider") ?: return@withContext Result.failure()
        if (provider != "Jamendo" || !url.startsWith("https://")) return@withContext Result.failure()
        var partialFile: File? = null
        try {
            setForeground(createForegroundInfo("Загружаем трек…"))
            val client = OkHttpClient.Builder().callTimeout(10, TimeUnit.MINUTES).build()
            val response = client.newCall(Request.Builder().url(url).header("Accept", "audio/*,application/octet-stream;q=0.9").build()).execute()
            response.use {
                if (!it.isSuccessful) {
                    return@withContext if (it.code >= 500 || it.code == 429) Result.retry() else Result.failure()
                }
                val body = it.body ?: return@withContext Result.failure()
                val contentType = it.header("Content-Type").orEmpty().lowercase()
                if (contentType.startsWith("text/") || contentType.contains("application/json")) {
                    return@withContext Result.failure()
                }
                val safeId = id.replace(Regex("[^A-Za-z0-9_-]"), "_")
                val directory = File(applicationContext.filesDir, "offline")
                if (!directory.exists() && !directory.mkdirs()) return@withContext Result.retry()
                val finalFile = File(directory, "$safeId.audio")
                partialFile = File(directory, "$safeId.audio.part")
                partialFile!!.delete()
                body.byteStream().use { input ->
                    partialFile!!.outputStream().use { output -> input.copyTo(output) }
                }
                if (!partialFile!!.exists() || partialFile!!.length() <= 0L) {
                    partialFile!!.delete()
                    return@withContext Result.retry()
                }
                if (finalFile.exists() && !finalFile.delete()) {
                    partialFile!!.delete()
                    return@withContext Result.retry()
                }
                if (!partialFile!!.renameTo(finalFile)) {
                    partialFile!!.delete()
                    return@withContext Result.retry()
                }
                partialFile = null
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
                Result.success()
            }
        } catch (_: Exception) {
            partialFile?.delete()
            Result.retry()
        }
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
