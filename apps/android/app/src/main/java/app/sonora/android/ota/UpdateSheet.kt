package app.sonora.android.ota

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.SystemUpdate
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.work.WorkInfo
import androidx.work.WorkManager
import app.sonora.android.BuildConfig
import java.io.File

private val SheetInk = Color(0xFF141522)
private val SheetLime = Color(0xFFC4B5FD)
private val SheetMuted = Color(0xFF9698AC)
private val SheetError = Color(0xFFFF9A8D)

/**
 * The in-app update dialog: release notes, size, and the two answers the user has.
 *
 * Everything from here on stays inside SONORA — the download runs in WorkManager and its
 * progress is read back from the same unique work the sheet started. A verified APK stays
 * ready in the sheet until the user taps Install.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun UpdateSheet(
    release: ReleaseInfo,
    onNotNow: () -> Unit,
    onUpdate: () -> Unit,
    onDownloadAgain: () -> Unit,
    onCancelDownload: () -> Unit,
    onInstall: (File) -> Unit,
    onDismiss: () -> Unit
) {
    val context = LocalContext.current
    val workManager = remember(context) { WorkManager.getInstance(context) }
    val infos by remember(workManager) {
        workManager.getWorkInfosForUniqueWorkFlow(OtaUpdate.UNIQUE_DOWNLOAD)
    }.collectAsState(initial = emptyList())
    // WorkManager's list may contain historical requests in unspecified order.
    // Only render the request explicitly recorded when this release was enqueued.
    val currentDownloadId = OtaPreferences.currentDownloadId(context)
    val info = infos.firstOrNull {
        it.id.toString() == currentDownloadId &&
            (it.state != WorkInfo.State.SUCCEEDED || it.outputData.getString(UpdateDownloadWorker.TAG) == release.tagName)
    }
    val workState = info?.state
    val progress = info?.progress?.getInt(UpdateDownloadWorker.PROGRESS, -1) ?: -1
    val downloaded = info?.progress?.getLong(UpdateDownloadWorker.DOWNLOADED, 0L) ?: 0L
    val total = info?.progress?.getLong(UpdateDownloadWorker.TOTAL, 0L) ?: release.apk?.size ?: 0L
    val failure = info?.outputData?.getString(UpdateDownloadWorker.ERROR).orEmpty()
    val downloading = workState == WorkInfo.State.RUNNING || workState == WorkInfo.State.ENQUEUED ||
        workState == WorkInfo.State.BLOCKED
    val readyFile = if (downloading) null else {
        OtaPreferences.readyApkFile(context, release.tagName)
    }

    val notes = chopNotes(release.notes)
    val sizeLabel = release.apkSizeLabel

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = SheetInk,
        contentColor = Color.White,
        shape = RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp)
    ) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 22.dp, vertical = 6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Default.SystemUpdate, contentDescription = null, tint = SheetLime, modifier = Modifier.size(22.dp))
                Spacer(Modifier.width(10.dp))
                Text("Доступно обновление SONORA", color = Color.White, fontSize = 19.sp, fontWeight = FontWeight.Bold)
            }
            Text(
                "Версия ${release.versionLabel} · сейчас ${BuildConfig.VERSION_NAME} · $sizeLabel" +
                    if (release.publishedAt.isNotBlank()) " · от ${formatPublishedAt(release.publishedAt)}" else "",
                color = SheetMuted,
                fontSize = 12.sp,
                modifier = Modifier.padding(top = 6.dp)
            )
            if (notes.isNotBlank()) {
                Text(
                    notes,
                    color = Color.White.copy(alpha = 0.86f),
                    fontSize = 13.sp,
                    lineHeight = 19.sp,
                    modifier = Modifier.padding(top = 12.dp)
                )
            }

            when {
                downloading -> {
                    LinearProgressIndicator(Modifier.fillMaxWidth().padding(top = 16.dp), color = SheetLime, trackColor = Color(0xFF26283B))
                    Text(
                        if (progress >= 0) "Загрузка обновления… $progress%"
                        else "Загрузка обновления… ${formatBytes(downloaded)}",
                        color = SheetLime,
                        fontSize = 12.sp,
                        modifier = Modifier.padding(top = 8.dp)
                    )
                }
                readyFile != null -> {
                    Text("APK скачан и готов к установке.", color = SheetLime, fontSize = 12.sp, modifier = Modifier.padding(top = 12.dp))
                }
                workState == WorkInfo.State.FAILED && failure.isNotBlank() -> {
                    Text(failure, color = SheetError, fontSize = 12.sp, modifier = Modifier.padding(top = 12.dp))
                }
                workState == WorkInfo.State.SUCCEEDED -> {
                    Text("Файл обновления потерян. Скачай его заново.", color = SheetError, fontSize = 12.sp, modifier = Modifier.padding(top = 12.dp))
                }
            }

            Row(Modifier.fillMaxWidth().padding(top = 18.dp, bottom = 26.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedButton(onClick = onNotNow, modifier = Modifier.weight(1f)) {
                    Text("Не сейчас", color = SheetMuted)
                }
                when {
                    downloading ->
                        Button(
                            onClick = onCancelDownload,
                            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF3A2C44), contentColor = Color.White),
                            modifier = Modifier.weight(1f)
                        ) { Text("Отменить") }
                    readyFile != null ->
                        Button(
                            onClick = { onInstall(readyFile) },
                            colors = ButtonDefaults.buttonColors(containerColor = SheetLime, contentColor = Color(0xFF080910)),
                            modifier = Modifier.weight(1f)
                        ) { Text("Установить") }
                    else ->
                        Button(
                            onClick = {
                                if (workState == WorkInfo.State.FAILED) onDownloadAgain() else onUpdate()
                            },
                            colors = ButtonDefaults.buttonColors(containerColor = SheetLime, contentColor = Color(0xFF080910)),
                            modifier = Modifier.weight(1f)
                        ) { Text(if (workState == WorkInfo.State.FAILED) "Повторить" else "Обновить") }
                }
            }
        }
    }
}
