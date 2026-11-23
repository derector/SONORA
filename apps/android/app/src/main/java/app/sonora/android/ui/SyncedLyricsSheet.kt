package app.sonora.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.sonora.android.data.SonoraApi
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.Request
import org.json.JSONObject

private data class LyricLine(val timeMs: Long, val text: String)

private sealed interface LyricsResult {
    data object Loading : LyricsResult
    data object Unavailable : LyricsResult
    data object Error : LyricsResult
    data class Available(val lines: List<LyricLine>, val rightsHolder: String) : LyricsResult
}

private val lyricClient by lazy {
    SonoraApi.sharedClient.newBuilder().callTimeout(8, TimeUnit.SECONDS).build()
}

private fun loadSyncedLyrics(trackId: String): LyricsResult {
    val url = SonoraApi.BASE.toHttpUrl().newBuilder()
        .addPathSegments("api/v1/lyrics")
        .addQueryParameter("id", trackId)
        .build()
    val request = Request.Builder().url(url).header("Accept", "application/json").build()
    lyricClient.newCall(request).execute().use { response ->
        if (response.code == 404) return LyricsResult.Unavailable
        if (!response.isSuccessful) throw IOException("Lyrics response failed")
        val payload = JSONObject(response.body?.string().orEmpty())
        if (payload.optString("status") == "unavailable") return LyricsResult.Unavailable
        if (payload.optString("status") != "available") throw IOException("Unexpected lyrics response")
        val rows = payload.optJSONArray("lines") ?: throw IOException("Lyrics response missing lines")
        val lines = buildList {
            for (index in 0 until minOf(rows.length(), 500)) {
                val row = rows.optJSONObject(index) ?: continue
                val text = row.optString("text").trim()
                val timeMs = row.optLong("timeMs", -1L)
                if (text.isNotEmpty() && timeMs >= 0L) add(LyricLine(timeMs, text))
            }
        }
        return if (lines.isEmpty()) LyricsResult.Unavailable
        else LyricsResult.Available(lines, payload.optString("rightsHolder"))
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SyncedLyricsSheet(
    trackId: String,
    positionMs: Long,
    onSeek: (Long) -> Unit,
    onDismiss: () -> Unit
) {
    var state by remember(trackId) { mutableStateOf<LyricsResult>(LyricsResult.Loading) }
    var attempt by remember(trackId) { mutableIntStateOf(0) }
    LaunchedEffect(trackId, attempt) {
        state = LyricsResult.Loading
        state = try {
            withContext(Dispatchers.IO) { loadSyncedLyrics(trackId) }
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            LyricsResult.Error
        }
    }

    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = Color(0xFF131428)) {
        Column(
            Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp)
                .sonoraGlass(RoundedCornerShape(24.dp)).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Text("Текст песни", style = MaterialTheme.typography.titleLarge, color = Color.White)
            when (val result = state) {
                LyricsResult.Loading -> Text("Загружаю текст…", color = Color.White)
                LyricsResult.Unavailable -> Text("Для этой записи нет лицензированного текста.", color = Color.White)
                LyricsResult.Error -> {
                    Text("Не удалось загрузить текст.", color = Color.White)
                    TextButton(onClick = { attempt++ }) { Text("Повторить") }
                }
                is LyricsResult.Available -> {
                    val listState = rememberLazyListState()
                    val activeIndex = result.lines.indexOfLast { it.timeMs <= positionMs }
                    LaunchedEffect(activeIndex) {
                        if (activeIndex >= 0) listState.scrollToItem((activeIndex - 1).coerceAtLeast(0))
                    }
                    LazyColumn(
                        modifier = Modifier.fillMaxWidth().heightIn(max = 360.dp),
                        state = listState,
                        verticalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        itemsIndexed(result.lines) { index, line ->
                            val active = index == activeIndex
                            val shape = RoundedCornerShape(12.dp)
                            Text(
                                text = line.text,
                                modifier = Modifier.fillMaxWidth().clip(shape)
                                    .background(if (active) Color(0x40AD90FF) else Color.Transparent)
                                    .clickable { onSeek(line.timeMs) }.padding(horizontal = 12.dp, vertical = 8.dp),
                                color = if (active) Color.White else Color(0xFFD7D3E5),
                                fontWeight = if (active) FontWeight.Bold else FontWeight.Medium,
                                fontSize = if (active) 20.sp else 17.sp
                            )
                        }
                    }
                    if (result.rightsHolder.isNotBlank()) Text(result.rightsHolder, color = Color(0xFFD7D3E5), fontSize = 12.sp)
                }
            }
        }
    }
}
