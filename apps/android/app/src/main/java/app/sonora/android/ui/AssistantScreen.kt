package app.sonora.android.ui

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.media.MediaDataSource
import android.media.MediaPlayer
import android.speech.RecognizerIntent
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.VolumeOff
import androidx.compose.material.icons.filled.VolumeUp
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import app.sonora.android.data.SonoraApi
import app.sonora.android.data.Track
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.Locale

private enum class DjMode(val title: String) { Text("Чат"), Dictation("Диктовка"), Live("Голосовой диалог") }
private enum class DjVoice(val id: String, val title: String, val pitch: Float, val rate: Float) {
    Alice("alice", "Алиса", 1.06f, 0.94f), Jarvis("jarvis", "Джарвис", 0.88f, 0.93f), Dj("dj", "SONORA DJ", 1f, 1.02f)
}
private data class DjTurn(val text: String, val yours: Boolean)
private const val Introduction = "Я — музыкальный помощник SONORA. Найду трек или соберу микс под ваше настроение."

@Composable
fun AssistantScreen(
    onBack: () -> Unit,
    onQuiet: () -> Unit,
    onResume: () -> Boolean,
    onPlay: (List<Track>, Track) -> Unit,
    onDuck: () -> (() -> Unit) = { {} }
) {
    val context = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val lifecycleState by lifecycle.currentStateFlow.collectAsState()
    val scope = rememberCoroutineScope()
    var draft by rememberSaveable { mutableStateOf("") }
    var mode by rememberSaveable { mutableStateOf(DjMode.Text) }
    var voice by rememberSaveable { mutableStateOf(DjVoice.Jarvis) }
    var voiceMenu by remember { mutableStateOf(false) }
    var voiceEnabled by rememberSaveable { mutableStateOf(true) }
    val turns = remember { mutableStateListOf(DjTurn(Introduction, false)) }
    val conversation = rememberLazyListState()
    var tracks by remember { mutableStateOf<List<Track>>(emptyList()) }
    var busy by remember { mutableStateOf(false) }
    var savingMix by remember { mutableStateOf(false) }
    var listening by rememberSaveable { mutableStateOf(false) }
    var liveSession by remember { mutableStateOf(false) }
    var rearm by remember { mutableStateOf(false) }
    var speechRestore by remember { mutableStateOf<(() -> Unit)?>(null) }
    var recognitionRestore by remember { mutableStateOf<(() -> Unit)?>(null) }
    var speaking by remember { mutableStateOf(false) }
    var status by remember { mutableStateOf("") }
    var speechReady by remember { mutableStateOf(false) }
    var speech by remember { mutableStateOf<TextToSpeech?>(null) }
    var speechJob by remember { mutableStateOf<Job?>(null) }
    var voicePlayer by remember { mutableStateOf<MediaPlayer?>(null) }
    var localUtterance by remember { mutableStateOf(0) }

    fun finishSpeech(success: Boolean) {
        speechRestore?.invoke()
        speechRestore = null
        speaking = false
        if (!success) {
            liveSession = false
            rearm = false
        }
    }

    fun endDialogue() {
        liveSession = false
        rearm = false
    }

    fun stopSpeech() {
        speechJob?.cancel()
        speechJob = null
        voicePlayer?.release()
        voicePlayer = null
        localUtterance++
        speech?.stop()
        speechRestore?.invoke()
        speechRestore = null
        speaking = false
    }

    DisposableEffect(context, lifecycle) {
        val engine = TextToSpeech(context) { result -> speechReady = result == TextToSpeech.SUCCESS }
        speech = engine
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_STOP) {
                stopSpeech()
                if (!listening) endDialogue()
            }
        }
        lifecycle.addObserver(observer)
        onDispose {
            lifecycle.removeObserver(observer)
            endDialogue()
            stopSpeech()
            recognitionRestore?.invoke()
            recognitionRestore = null
            engine.shutdown()
            speech = null
        }
    }

    fun speakLocally(text: String, preset: DjVoice) {
        val engine = speech
        if (!speechReady || engine == null || engine.setLanguage(Locale.forLanguageTag("ru-RU")) < 0) {
            finishSpeech(success = false)
            status = "Русский голос недоступен. Ответ можно прочитать в чате."
            return
        }
        engine.voices?.filter {
            it.locale.language == "ru" && !it.isNetworkConnectionRequired && TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED !in it.features
        }?.maxByOrNull { it.quality }?.let(engine::setVoice)
        engine.setPitch(preset.pitch)
        engine.setSpeechRate(preset.rate)
        val id = (++localUtterance).toString()
        engine.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
            override fun onStart(utteranceId: String) = Unit
            override fun onDone(utteranceId: String) {
                scope.launch { if (utteranceId == localUtterance.toString()) finishSpeech(success = true) }
            }
            @Deprecated("Required for engines using the legacy callback")
            override fun onError(utteranceId: String) {
                scope.launch {
                    if (utteranceId == localUtterance.toString()) {
                        finishSpeech(success = false)
                        status = "Не удалось озвучить ответ. Он доступен в чате."
                    }
                }
            }
        })
        val normalized = text.replace(Regex("\\bSONORA\\b", RegexOption.IGNORE_CASE), "Сонора")
        if (engine.speak(normalized, TextToSpeech.QUEUE_FLUSH, null, id) != TextToSpeech.SUCCESS) {
            finishSpeech(success = false)
            status = "Не удалось озвучить ответ. Он доступен в чате."
            return
        }
        status = if (SonoraApi.isSignedIn()) "Облачный голос недоступен. Используется голос Android." else "В гостевом режиме используется голос Android."
    }

    fun say(text: String, resumeDialogue: Boolean = false) {
        stopSpeech()
        rearm = resumeDialogue
        speechRestore = onDuck()
        speaking = true
        val preset = voice
        speechJob = scope.launch {
            val bytes = try { withContext(Dispatchers.IO) { SonoraApi.synthesizeAssistantSpeech(text, preset.id) } }
            catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { null }
            if (bytes == null) {
                speakLocally(text, preset)
                return@launch
            }
            val player = MediaPlayer()
            voicePlayer = player
            try {
                player.setDataSource(object : MediaDataSource() {
                    override fun getSize() = bytes.size.toLong()
                    override fun close() = Unit
                    override fun readAt(position: Long, buffer: ByteArray, offset: Int, size: Int): Int {
                        if (size == 0) return 0
                        if (position < 0 || position >= bytes.size) return -1
                        val start = position.toInt()
                        val count = minOf(size, bytes.size - start)
                        bytes.copyInto(buffer, offset, start, start + count)
                        return count
                    }
                })
                player.setOnPreparedListener { if (voicePlayer === it) it.start() }
                player.setOnCompletionListener {
                    if (voicePlayer === it) {
                        voicePlayer = null
                        it.release()
                        finishSpeech(success = true)
                    }
                }
                player.setOnErrorListener { media, _, _ ->
                    if (voicePlayer === media) {
                        voicePlayer = null
                        media.release()
                        speakLocally(text, preset)
                    }
                    true
                }
                player.prepareAsync()
            } catch (_: Exception) {
                voicePlayer = null
                player.release()
                speakLocally(text, preset)
            }
        }
    }

    fun append(text: String, yours: Boolean = false) {
        turns.add(DjTurn(text, yours))
        while (turns.size > 32) turns.removeAt(0)
    }

    fun ask(raw: String) {
        val text = raw.trim()
        if (busy || text.length < 2) return
        stopSpeech()
        status = ""
        append(text, yours = true)
        draft = ""
        val command = text.lowercase(Locale.ROOT).replace('ё', 'е').replace(Regex("[.!?,]"), "").trim().replace(Regex("\\s+"), " ")
        when (command) {
            "пауза", "останови музыку", "поставь на паузу", "стоп" -> {
                endDialogue()
                onQuiet()
                append("Воспроизведение приостановлено.")
                return
            }
            "продолжить", "продолжи", "продолжи музыку", "возобнови музыку" -> {
                endDialogue()
                append(if (onResume()) "Возобновляю воспроизведение." else "Сначала выберите трек или попросите подобрать музыку.")
                return
            }
            "слушать", "слушать подборку", "включи подборку", "включи микс" -> {
                endDialogue()
                if (tracks.isEmpty()) append("Подборки пока нет. Назовите настроение или исполнителя.")
                else {
                    onPlay(tracks, tracks.first())
                    append("Запускаю последнюю подборку.")
                }
                return
            }
        }
        val wasInDialogue = liveSession
        busy = true
        scope.launch {
            try {
                val result = withContext(Dispatchers.IO) { SonoraApi.askAssistant(text) }
                append(result.reply)
                if (result.tracks.isNotEmpty()) tracks = result.tracks
                if (voiceEnabled && mode == DjMode.Live && (!wasInDialogue || liveSession) && lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) {
                    say(result.reply, resumeDialogue = liveSession)
                }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) {
                endDialogue()
                draft = text
                status = "Не удалось получить ответ. Проверьте подключение и повторите запрос."
            } finally { busy = false }
        }
    }

    val recognition = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        listening = false
        recognitionRestore?.invoke()
        recognitionRestore = null
        if (result.resultCode == Activity.RESULT_OK) {
            val text = result.data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull()?.trim()?.take(300)
            if (text.isNullOrBlank()) {
                endDialogue()
                status = "Речь не распознана. Попробуйте ещё раз."
            } else if (mode == DjMode.Live && liveSession) ask(text)
            else {
                draft = text
                status = "Проверьте текст перед отправкой."
            }
        } else {
            endDialogue()
            status = "Голосовой запрос отменён. Можно написать текст."
        }
    }

    fun startRecognition() {
        if (busy || listening) return
        stopSpeech()
        status = ""
        recognitionRestore = onDuck()
        listening = true
        try {
            recognition.launch(Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                .putExtra(RecognizerIntent.EXTRA_LANGUAGE, "ru-RU")
                .putExtra(RecognizerIntent.EXTRA_PROMPT, "Что хотите послушать?")
                .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1))
        } catch (error: RuntimeException) {
            listening = false
            recognitionRestore?.invoke()
            recognitionRestore = null
            endDialogue()
            status = when (error) {
                is ActivityNotFoundException -> "Распознавание речи недоступно. Введите запрос текстом."
                is SecurityException -> "Микрофон недоступен. Проверьте разрешения или введите запрос текстом."
                else -> "Не удалось открыть распознавание. Введите запрос текстом."
            }
        }
    }

    LaunchedEffect(rearm, liveSession, busy, listening, speaking, lifecycleState) {
        if (rearm && liveSession && !busy && !listening && !speaking && lifecycleState == Lifecycle.State.RESUMED) {
            rearm = false
            startRecognition()
        }
    }

    fun saveMix() {
        if (savingMix) return
        if (!SonoraApi.isSignedIn()) { status = "Войдите в аккаунт, чтобы сохранить подборку."; return }
        val trackCount = tracks.size
        val selection = tracks.filter { it.provider == "Audius" || it.provider == "Jamendo" }
        if (selection.isEmpty()) { status = "В этой подборке нет треков, доступных для сохранения."; return }
        endDialogue()
        stopSpeech()
        savingMix = true
        status = "Сохраняю подборку…"
        scope.launch {
            try {
                val added = withContext(Dispatchers.IO) {
                    val playlist = SonoraApi.createPlaylist("Микс SONORA AI DJ")
                    var saved = 0
                    for (track in selection) {
                        if (runCatching { SonoraApi.addTrackToPlaylist(playlist.id, track) }.isSuccess) saved++
                    }
                    if (saved == 0) SonoraApi.deletePlaylist(playlist.id)
                    saved
                }
                status = if (added > 0) "Плейлист сохранён в медиатеке. Добавлено треков: $added из $trackCount."
                    else "Сохранить подборку не удалось. Попробуйте ещё раз."
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { status = "Сохранить подборку не удалось. Проверьте медиатеку или повторите запрос." }
            finally { savingMix = false }
        }
    }

    fun beginDialogue() {
        if (busy || listening) return
        voiceEnabled = true
        mode = DjMode.Live
        liveSession = true
        startRecognition()
    }

    LazyColumn(Modifier.fillMaxSize().background(GlassBackdrop), contentPadding = PaddingValues(18.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        item {
            TextButton(onClick = { endDialogue(); stopSpeech(); onBack() }) { Text("Назад") }
            Column(
                Modifier.fillMaxWidth().sonoraGlass(RoundedCornerShape(30.dp), GlassTone.Accent).padding(14.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    IconButton(enabled = !busy && !listening, onClick = ::beginDialogue,
                        modifier = Modifier.semantics { contentDescription = "Открыть живой разговор" }) {
                        DjOrb(listening || busy || speaking)
                    }
                    Column(Modifier.weight(1f)) {
                        Text("SONORA AI DJ", color = Color.White, fontSize = 18.sp)
                        Text(if (listening) "Слушаю…" else if (busy) "Подбираю музыку…" else if (speaking) "Отвечаю…" else "Помощник SONORA",
                            color = Color(0xFFE2D9FA), fontSize = 12.sp, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
                    }
                    IconButton(onClick = {
                        voiceEnabled = !voiceEnabled
                        if (!voiceEnabled) { endDialogue(); stopSpeech() }
                    }) {
                        Icon(if (voiceEnabled) Icons.Default.VolumeUp else Icons.Default.VolumeOff,
                            contentDescription = if (voiceEnabled) "Выключить озвучку" else "Включить озвучку")
                    }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(
                        enabled = liveSession || (!busy && !listening),
                        onClick = { if (liveSession) { endDialogue(); stopSpeech() } else beginDialogue() },
                        modifier = Modifier.weight(1f),
                        contentPadding = PaddingValues(horizontal = 6.dp, vertical = 8.dp)
                    ) { Text(if (liveSession) "Завершить диалог" else "Живой разговор", fontSize = 12.sp) }
                    Box(Modifier.weight(1f)) {
                        OutlinedButton(onClick = { voiceMenu = true }, modifier = Modifier.fillMaxWidth(),
                            contentPadding = PaddingValues(horizontal = 6.dp, vertical = 8.dp)) {
                            Text("Голос: ${voice.title}", fontSize = 12.sp)
                        }
                        DropdownMenu(expanded = voiceMenu, onDismissRequest = { voiceMenu = false }) {
                            DjVoice.entries.forEach { choice ->
                                DropdownMenuItem(text = { Text(choice.title) }, onClick = {
                                    endDialogue(); stopSpeech(); voice = choice; voiceMenu = false
                                })
                            }
                        }
                    }
                }
                LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    item { AssistChip(onClick = { ask("Подбери спокойную музыку для вечера") }, enabled = !busy, label = { Text("Спокойная для вечера") }) }
                    item { AssistChip(onClick = { ask("Микс для тренировки") }, enabled = !busy, label = { Text("Для тренировки") }) }
                    item { AssistChip(onClick = { ask("Подбери энергичную музыку") }, enabled = !busy, label = { Text("Смени вайб") }) }
                }
            }
        }
        item {
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                DjMode.entries.forEach { choice ->
                    FilterChip(selected = mode == choice, onClick = { endDialogue(); stopSpeech(); mode = choice; status = "" },
                        label = { Text(choice.title) }, enabled = !busy && !listening)
                }
            }
        }

        item {
            Column(Modifier.fillMaxWidth().sonoraGlass(RoundedCornerShape(20.dp), GlassTone.Accent).padding(12.dp)) {
                Text("Диалог", color = Color.White, modifier = Modifier.padding(bottom = 8.dp))
                if (turns.size == 1) {
                    Text(turns.first().text, color = Color.White, modifier = Modifier.padding(8.dp))
                } else {
                    LazyColumn(state = conversation, modifier = Modifier.heightIn(max = 280.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        items(turns) { turn ->
                            Text(if (turn.yours) "Вы · ${turn.text}" else turn.text,
                                color = if (turn.yours) Color(0xFFE2CBFF) else Color.White,
                                modifier = Modifier.fillMaxWidth().padding(8.dp))
                        }
                    }
                    LaunchedEffect(turns.size, turns.lastOrNull()) { if (turns.isNotEmpty()) conversation.scrollToItem(turns.lastIndex) }
                }
            }
        }
        item {
            OutlinedTextField(value = draft, onValueChange = { draft = it.take(300) }, label = { Text("Настроение, исполнитель или трек") }, modifier = Modifier.fillMaxWidth())
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(enabled = !busy && !listening && draft.trim().length >= 2, onClick = { ask(draft) }) { Text("Подобрать") }
                OutlinedButton(enabled = !busy && !listening, onClick = {
                    if (mode == DjMode.Text) mode = DjMode.Dictation
                    liveSession = mode == DjMode.Live
                    startRecognition()
                }) { Text("Сказать") }
                if (voiceEnabled) OutlinedButton(enabled = !busy && !listening, onClick = { say(turns.lastOrNull { !it.yours }?.text ?: Introduction) }) { Text("Озвучить") }
            }
            if (mode != DjMode.Text) {
                val guidance = if (mode == DjMode.Live) "В режиме диалога после озвучивания снова открывается микрофон. Чтобы остановиться, нажмите «Завершить диалог» или отмените окно распознавания. SONORA получает текст от системной службы речи."
                    else "Системная служба распознаёт речь. Проверьте и при необходимости исправьте текст перед отправкой."
                Text(guidance + " При облачной озвучке текст ответа передаётся сервису синтеза речи.", color = Color(0xFFBEB9CE), fontSize = 12.sp)
            }
        }
        if (busy) item { LinearProgressIndicator(Modifier.fillMaxWidth()) }
        if (status.isNotBlank()) item { Text(status, color = Color(0xFFD8CCFF), modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite }) }
        if (tracks.isNotEmpty()) item {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Button(onClick = { endDialogue(); stopSpeech(); onPlay(tracks, tracks.first()) }) { Text("Слушать подборку · ${tracks.size}") }
                OutlinedButton(enabled = !savingMix, onClick = ::saveMix) { Text("Создать плейлист из подборки") }
            }
        }
        items(tracks, key = { "${it.provider}:${it.id}" }) { track ->
            OutlinedButton(modifier = Modifier.fillMaxWidth(), onClick = { endDialogue(); stopSpeech(); onPlay(tracks, track) }) {
                Text("${track.title} — ${track.artist}", modifier = Modifier.padding(6.dp))
            }
        }
    }
}

@Composable
private fun DjOrb(active: Boolean) {
    val intensity by animateFloatAsState(if (active) 1f else 0.45f, if (rememberMotionEnabled()) tween(300) else snap(), label = "dj-orb")
    Canvas(Modifier.size(38.dp).clearAndSetSemantics {}) {
        val radius = size.minDimension * 0.37f
        drawCircle(Brush.radialGradient(listOf(Color(0xFFA783F8).copy(alpha = intensity * 0.48f), Color.Transparent), center, radius * 1.35f), radius * 1.35f)
        drawCircle(Brush.radialGradient(listOf(Color(0xFFE3D5FB), Color(0xFF9C7BDD), Color(0xFF473368), Color(0xFF241D43)),
            center - Offset(radius * 0.28f, radius * 0.36f), radius * 1.48f), radius)
        drawCircle(Brush.radialGradient(listOf(Color.White.copy(alpha = intensity * 0.8f), Color.Transparent),
            center - Offset(radius * 0.38f, radius * 0.45f), radius * 0.40f), radius)
    }
}
