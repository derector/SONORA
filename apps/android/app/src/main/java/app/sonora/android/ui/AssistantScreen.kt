package app.sonora.android.ui

import android.app.Activity
import android.content.Intent
import android.speech.RecognizerIntent
import android.speech.tts.TextToSpeech
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.sonora.android.data.SonoraApi
import app.sonora.android.data.Track
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.CancellationException
import java.util.Locale

@Composable
fun AssistantScreen(onBack: () -> Unit, onQuiet: () -> Unit, onResume: () -> Boolean, onPlay: (List<Track>, Track) -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var draft by rememberSaveable { mutableStateOf("") }
    var answer by rememberSaveable { mutableStateOf("Я — музыкальный помощник SONORA. Помогу найти треки, подобрать музыку под настроение и собрать ваш микс. Что хотите послушать?") }
    var tracks by remember { mutableStateOf<List<Track>>(emptyList()) }
    var busy by remember { mutableStateOf(false) }
    var status by remember { mutableStateOf("") }
    var voiceMode by rememberSaveable { mutableStateOf(false) }
    var speechReady by remember { mutableStateOf(false) }
    var speech by remember { mutableStateOf<TextToSpeech?>(null) }
    DisposableEffect(context) {
        val engine = TextToSpeech(context) { result -> speechReady = result == TextToSpeech.SUCCESS }
        speech = engine
        onDispose { engine.stop(); engine.shutdown(); speech = null }
    }
    fun say(text: String) {
        val engine = speech
        if (!voiceMode || !speechReady || engine == null) return
        if (engine.setLanguage(Locale.forLanguageTag("ru-RU")) < 0) {
            status = "Русский голос недоступен. Установите его в настройках синтеза речи."; return
        }
        onQuiet()
        engine.speak(text, TextToSpeech.QUEUE_FLUSH, null, "sonora-assistant")
    }
    fun ask(text: String) {
        if (busy || text.trim().length < 2) return
        speech?.stop()
        val command = text.lowercase(Locale.ROOT).replace('ё', 'е').replace(Regex("[.!?,]"), "").trim().replace(Regex("\\s+"), " ")
        when (command) {
            "пауза", "останови музыку", "поставь на паузу", "стоп" -> { onQuiet(); answer = "Воспроизведение приостановлено."; return }
            "продолжить", "продолжи", "продолжи музыку", "возобнови музыку" -> { answer = if (onResume()) "Возобновляю воспроизведение." else "Сначала выберите трек или попросите подобрать музыку."; return }
            "слушать", "слушать подборку", "включи подборку", "включи микс" -> {
                if (tracks.isNotEmpty()) { onPlay(tracks, tracks.first()); answer = "Запускаю последнюю подборку." }
                else answer = "Подборки пока нет. Назовите настроение или исполнителя."
                return
            }
        }
        busy = true; status = "Подбираю музыку…"
        scope.launch {
            try {
                val result = withContext(Dispatchers.IO) { SonoraApi.askAssistant(text.trim()) }
                answer = result.reply; tracks = result.tracks; status = ""
                say(result.reply)
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { status = "Не удалось получить ответ. Проверьте подключение и повторите запрос." }
            finally { busy = false }
        }
    }
    val recognition = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        if (result.resultCode == Activity.RESULT_OK) {
            val text = result.data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull()
            if (!text.isNullOrBlank()) { draft = text.take(300); if (voiceMode) ask(draft) }
            else status = "Речь не распознана. Попробуйте ещё раз."
        } else status = "Голосовой запрос отменён. Можно написать текст."
    }
    LazyColumn(Modifier.fillMaxSize().background(GlassBackdrop), contentPadding = PaddingValues(18.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        item {
            TextButton(onClick = onBack) { Text("Назад") }
            Column(Modifier.fillMaxWidth().sonoraGlass(RoundedCornerShape(26.dp), GlassTone.Accent).padding(20.dp)) {
                Text("Помощник SONORA", color = Color.White, fontSize = 25.sp)
                Text("Команды: слушать подборку, пауза, продолжить", color = Color(0xFFD8CCFF), modifier = Modifier.padding(top = 8.dp))
                Row {
                    TextButton(enabled = speechReady, onClick = { voiceMode = !voiceMode; if (voiceMode) say("Я — музыкальный помощник SONORA. Помогу найти треки и собрать микс под ваше настроение. Нажмите «Сказать», чтобы обратиться ко мне.") else speech?.stop() }) { Text(if (voiceMode) "Голос включён" else "Голосовой помощник") }
                    TextButton(onClick = { speech?.stop() }) { Text("Тише") }
                }
            }
        }
        item { Text(answer, color = Color.White, modifier = Modifier.padding(8.dp)) }
        item {
            OutlinedTextField(value = draft, onValueChange = { draft = it.take(300) }, label = { Text("Настроение, исполнитель или трек") }, modifier = Modifier.fillMaxWidth())
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(enabled = !busy && draft.trim().length >= 2, onClick = { ask(draft) }) { Text("Подобрать") }
                OutlinedButton(enabled = !busy, onClick = {
                    speech?.stop(); onQuiet()
                    try {
                        recognition.launch(Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                            .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                            .putExtra(RecognizerIntent.EXTRA_LANGUAGE, "ru-RU")
                            .putExtra(RecognizerIntent.EXTRA_PROMPT, "Что хотите послушать?")
                            .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1))
                    } catch (_: Exception) { status = "Распознавание речи недоступно. Введите запрос текстом." }
                }) { Text("Сказать") }
            }
            Text("Речь обрабатывает системный сервис. SONORA получает текст. В голосовом режиме запрос отправляется сразу.", color = Color(0xFFB1AEC2), fontSize = 12.sp)
        }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                AssistChip(onClick = { draft = "Мой микс по моим вкусам"; ask(draft) }, enabled = !busy, label = { Text("Мой микс") })
                AssistChip(onClick = { draft = "Микс для тренировки"; ask(draft) }, enabled = !busy, label = { Text("Энергия") })
                AssistChip(onClick = { draft = "Подбери спокойную музыку"; ask(draft) }, enabled = !busy, label = { Text("Релакс") })
            }
        }
        if (busy) item { LinearProgressIndicator(Modifier.fillMaxWidth()) }
        if (status.isNotBlank()) item { Text(status, color = Color(0xFFD8CCFF)) }
        if (tracks.isNotEmpty()) item { Button(onClick = { speech?.stop(); onPlay(tracks, tracks.first()) }) { Text("Слушать подборку · ${tracks.size}") } }
        items(tracks, key = { "${it.provider}:${it.id}" }) { track ->
            OutlinedButton(modifier = Modifier.fillMaxWidth(), onClick = { speech?.stop(); onPlay(tracks, track) }) {
                Text("${track.title} — ${track.artist}", modifier = Modifier.padding(6.dp))
            }
        }
    }
}
