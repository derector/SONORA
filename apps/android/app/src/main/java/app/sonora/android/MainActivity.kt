package app.sonora.android

import android.Manifest
import android.content.ComponentName
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.activity.compose.setContent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Player
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import androidx.work.*
import androidx.compose.runtime.collectAsState
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat
import app.sonora.android.data.OfflineDatabase
import app.sonora.android.data.OfflineTrack
import coil.compose.AsyncImage
import app.sonora.android.data.SonoraApi
import app.sonora.android.data.Track
import app.sonora.android.download.TrackDownloadWorker
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.delay
import java.io.File

private val Ink = Color(0xFF08090D)
private val Panel = Color(0xFF151820)
private val Lime = Color(0xFFB8F36B)
private val Muted = Color(0xFF9298A5)

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        super.onCreate(savedInstanceState)
        SonoraApi.initialize(this)
        setContent { SonoraApp() }
    }
}

@Composable
private fun SonoraApp() {
    val context = androidx.compose.ui.platform.LocalContext.current
    val scope = rememberCoroutineScope()
    var tab by remember { mutableStateOf("Главная") }
    var provider by remember { mutableStateOf("Audius") }
    var tracks by remember { mutableStateOf<List<Track>>(emptyList()) }
    var activeQueue by remember { mutableStateOf<List<Track>>(emptyList()) }
    var current by remember { mutableStateOf<Track?>(null) }
    var query by remember { mutableStateOf("") }
    var searchResults by remember { mutableStateOf<List<Track>>(emptyList()) }
    var email by remember { mutableStateOf(SonoraApi.email()) }
    var username by remember { mutableStateOf("") }
    var displayName by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }
    var authStep by remember { mutableStateOf(if (SonoraApi.isSignedIn()) "signed" else "welcome") }
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf("") }
    var controller by remember { mutableStateOf<MediaController?>(null) }
    var isPlaying by remember { mutableStateOf(false) }

    fun loadTracks(source: String, done: (List<Track>) -> Unit) {
        scope.launch {
            busy = true
            try { done(withContext(Dispatchers.IO) { SonoraApi.discover(source) }); message = "" }
            catch (e: Exception) { message = e.message ?: "Не удалось загрузить каталог" }
            finally { busy = false }
        }
    }

    LaunchedEffect(Unit) {
        try {
            val restored = withContext(Dispatchers.IO) { SonoraApi.restoreSession() }
            authStep = if (restored) "signed" else "welcome"
        } catch (_: Exception) {
            authStep = "welcome"
        }
        try {
            controller = withContext(Dispatchers.IO) {
                MediaController.Builder(context, SessionToken(context, ComponentName(context, app.sonora.android.playback.PlaybackService::class.java))).buildAsync().get(10, TimeUnit.SECONDS)
            }
        } catch (_: Exception) { message = "Плеер подключится при следующем запуске" }
        loadTracks("Audius") { tracks = it }
    }

    DisposableEffect(controller, tracks, activeQueue) {
        val player = controller
        if (player == null) return@DisposableEffect onDispose { }
        val listener = object : Player.Listener {
            override fun onIsPlayingChanged(playing: Boolean) { isPlaying = playing }
            override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
                val mediaId = mediaItem?.mediaId ?: return
                (activeQueue + tracks).firstOrNull { "${it.provider}:${it.id}" == mediaId }?.let { current = it }
            }
        }
        player.addListener(listener)
        isPlaying = player.isPlaying
        onDispose { player.removeListener(listener) }
    }

    fun mediaItem(track: Track, url: String): MediaItem {
        val metadata = MediaMetadata.Builder().setTitle(track.title).setArtist(track.artist)
            .setAlbumTitle(track.album).setArtworkUri(track.artworkUrl?.let { android.net.Uri.parse(it) }).build()
        return MediaItem.Builder().setMediaId("${track.provider}:${track.id}").setUri(url).setMediaMetadata(metadata).build()
    }

    fun startTrack(track: Track, local: Boolean = false) {
        val player = controller
        if (player == null) { message = "Плеер ещё запускается"; return }
        val url = if (local) track.audioUrl else track.audioUrl
        if (url.isNullOrBlank()) { message = "У этого трека нет доступного источника"; return }
        if (local) {
            activeQueue = listOf(track)
            player.setMediaItem(mediaItem(track, url))
            player.prepare()
            player.play()
            current = track
            return
        }
        val queue = (tracks.filter { it.playable && !it.audioUrl.isNullOrBlank() } + track)
            .distinctBy { "${it.provider}:${it.id}" }
        activeQueue = queue
        val selectedIndex = queue.indexOfFirst { "${it.provider}:${it.id}" == "${track.provider}:${track.id}" }.coerceAtLeast(0)
        player.setMediaItems(queue.map { mediaItem(it, it.audioUrl!!) }, selectedIndex, 0L)
        player.prepare()
        player.play()
        current = track
    }

    fun play(track: Track) = startTrack(track)

    fun playOffline(track: OfflineTrack) {
        val localTrack = Track(
            id = track.id, providerTrackId = track.id, provider = track.provider,
            title = track.title, artist = track.artist, durationSeconds = track.durationSeconds,
            artworkUrl = track.artworkUrl, audioUrl = android.net.Uri.fromFile(File(track.localPath)).toString(),
            playable = true
        )
        startTrack(localTrack, local = true)
    }

    MaterialTheme(colorScheme = darkColorScheme(
        primary = Lime, onPrimary = Ink, background = Ink, surface = Panel,
        onBackground = Color.White, onSurface = Color.White, secondary = Lime
    )) {
        Scaffold(
            containerColor = Ink,
            bottomBar = {
                Column {
                    current?.let { MiniPlayer(it, onClick = { tab = "Плеер" }, onPlay = { if (isPlaying) controller?.pause() else controller?.play() }, playing = controller?.isPlaying == true) }
                    NavigationBar(containerColor = Color(0xFF101219), contentColor = Lime) {
                        listOf("Главная" to Icons.Default.Home, "Поиск" to Icons.Default.Search, "Медиатека" to Icons.Default.LibraryMusic, "Загрузки" to Icons.Default.Download, "Профиль" to Icons.Default.Person).forEach { (name, icon) ->
                            NavigationBarItem(selected = tab == name, onClick = { tab = name }, icon = { Icon(icon, null) }, label = { Text(name, fontSize = 10.sp) }, colors = NavigationBarItemDefaults.colors(selectedIconColor = Lime, selectedTextColor = Lime, indicatorColor = Color(0xFF26321B), unselectedIconColor = Muted, unselectedTextColor = Muted))
                        }
                    }
                }
            }
        ) { padding ->
            AnimatedContent(tab, modifier = Modifier.padding(padding), transitionSpec = { fadeIn() togetherWith fadeOut() }, label = "tab") { screen ->
                when (screen) {
                    "Главная" -> DiscoverScreen(tracks, provider, busy, message, { source -> provider = source; loadTracks(source) { tracks = it } }, ::play, { tab = "Плеер" })
                    "Поиск" -> SearchScreen(query, { value -> query = value; searchResults = emptyList(); message = "" }, searchResults, busy, message, {
                        val term = query.trim()
                        if (term.isBlank()) {
                            searchResults = emptyList()
                            message = "Введите название трека или исполнителя"
                        } else {
                            scope.launch {
                                busy = true
                                message = ""
                                try { searchResults = withContext(Dispatchers.IO) { SonoraApi.search(term) } }
                                catch (e: Exception) { searchResults = emptyList(); message = e.message ?: "Ошибка поиска" }
                                finally { busy = false }
                            }
                        }
                    }, ::play)
                    "Медиатека" -> LibraryScreen(
                        signedIn = authStep == "signed",
                        currentTrack = current,
                        openProfile = { tab = "Профиль" },
                        play = ::play
                    )
                    "Загрузки" -> DownloadsScreen(onPlay = ::playOffline, onDelete = { item ->
                        scope.launch(Dispatchers.IO) {
                            runCatching { File(item.localPath).delete() }
                            OfflineDatabase.get(context).offlineTracks().delete(item.provider, item.id)
                        }
                    })
                    "Профиль" -> ProfileScreen(authStep, email, { email = it }, username, { username = it }, displayName, { displayName = it }, code, { code = it }, busy, message,
                        onRegister = {
                            scope.launch { busy = true; try { withContext(Dispatchers.IO) { SonoraApi.requestOtp(email, username, displayName, true) }; authStep = "verify"; message = "Код отправлен на почту" } catch (e: Exception) { message = e.message ?: "Ошибка регистрации" }; busy = false }
                        },
                        onLogin = {
                            scope.launch { busy = true; try { withContext(Dispatchers.IO) { SonoraApi.requestOtp(email, register = false) }; authStep = "verify"; message = "Если аккаунт существует, код отправлен" } catch (e: Exception) { message = e.message ?: "Ошибка входа" }; busy = false }
                        },
                        onVerify = {
                            scope.launch { busy = true; try { withContext(Dispatchers.IO) { SonoraApi.verifyOtp(email, code) }; authStep = "signed"; message = "Вход выполнен" } catch (e: Exception) { message = e.message ?: "Неверный код" }; busy = false }
                        },
                        onLogout = {
                            scope.launch {
                                busy = true
                                withContext(Dispatchers.IO) { SonoraApi.logout() }
                                authStep = "welcome"
                                message = "Вы вышли из аккаунта"
                                busy = false
                            }
                        }
                    )
                    else -> FullPlayer(current, activeQueue, controller, controller?.isPlaying == true, { controller?.pause() }, { controller?.play() }, { controller?.seekToPrevious() }, { controller?.seekToNext() })
                }
            }
        }
    }
}

@Composable
private fun DiscoverScreen(tracks: List<Track>, provider: String, busy: Boolean, message: String, choose: (String) -> Unit, play: (Track) -> Unit, openPlayer: () -> Unit) {
    Column(Modifier.fillMaxSize().background(Ink)) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 22.dp, vertical = 18.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("SONORA", color = Lime, fontSize = 13.sp, fontWeight = FontWeight.Black, letterSpacing = 4.sp)
                Text("Твоя музыка. Твой поток.", color = Color.White, fontSize = 25.sp, fontWeight = FontWeight.Bold)
            }
            Box(Modifier.size(42.dp).clip(CircleShape).background(Brush.linearGradient(listOf(Lime, Color(0xFF4A9C82)))), contentAlignment = Alignment.Center) { Text("S", color = Ink, fontWeight = FontWeight.Black, fontSize = 23.sp) }
        }
        Row(Modifier.padding(horizontal = 20.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf("Audius", "Jamendo").forEach { source ->
                FilterChip(selected = provider == source, onClick = { choose(source) }, label = { Text(source) }, colors = FilterChipDefaults.filterChipColors(selectedContainerColor = Lime, selectedLabelColor = Ink))
            }
        }
        Text("Подборка для тебя", Modifier.padding(start = 22.dp, top = 24.dp, bottom = 10.dp), color = Color.White, fontSize = 19.sp, fontWeight = FontWeight.Bold)
        if (busy) LinearProgressIndicator(Modifier.fillMaxWidth(), color = Lime, trackColor = Panel)
        if (message.isNotBlank()) Text(message, Modifier.padding(horizontal = 22.dp, vertical = 8.dp), color = Muted)
        if (!busy && tracks.isEmpty() && message.isBlank()) {
            Column(
                Modifier.fillMaxWidth().padding(horizontal = 22.dp, vertical = 20.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Text(
                    if (provider == "Jamendo") "Jamendo пока не вернул доступных треков" else "Пока нет доступных треков",
                    color = Color.White,
                    fontWeight = FontWeight.SemiBold
                )
                Text(
                    "Проверьте подключение и попробуйте обновить каталог.",
                    color = Muted,
                    modifier = Modifier.padding(top = 6.dp, bottom = 14.dp)
                )
                Button(
                    onClick = { choose(provider) },
                    colors = ButtonDefaults.buttonColors(containerColor = Lime, contentColor = Ink)
                ) {
                    Icon(Icons.Default.Refresh, contentDescription = null)
                    Spacer(Modifier.width(8.dp))
                    Text("Повторить")
                }
            }
        }
        LazyColumn(contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 18.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(tracks, key = { it.provider + ":" + it.id }) { track -> TrackRow(track, { play(track) }, openPlayer) }
        }
    }
}

@Composable
private fun SearchScreen(query: String, onQuery: (String) -> Unit, tracks: List<Track>, busy: Boolean, message: String, search: () -> Unit, play: (Track) -> Unit) {
    Column(Modifier.fillMaxSize().background(Ink).padding(horizontal = 18.dp)) {
        Text("Поиск", color = Color.White, fontSize = 28.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 22.dp, bottom = 16.dp))
        OutlinedTextField(
            value = query,
            onValueChange = onQuery,
            modifier = Modifier.fillMaxWidth(),
            placeholder = { Text("Трек, исполнитель, альбом") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
            keyboardActions = KeyboardActions(onSearch = { search() }),
            trailingIcon = { IconButton(onClick = search) { Icon(Icons.Default.Search, contentDescription = "Искать", tint = Lime) } },
            colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = Lime, unfocusedBorderColor = Panel, focusedTextColor = Color.White, unfocusedTextColor = Color.White)
        )
        if (busy) LinearProgressIndicator(Modifier.fillMaxWidth().padding(top = 8.dp), color = Lime)
        if (message.isNotBlank()) Text(message, color = Muted, modifier = Modifier.padding(vertical = 8.dp))
        LazyColumn(contentPadding = PaddingValues(vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) { items(tracks, key = { it.provider + ":" + it.id }) { TrackRow(it, { play(it) }, {}) } }
    }
}

@Composable
private fun TrackRow(track: Track, onPlay: () -> Unit, open: () -> Unit) {
    val context = LocalContext.current
    val workManager = remember(context) { WorkManager.getInstance(context) }
    val workName = "offline-" + track.provider + "-" + track.id
    val workInfos by remember(workManager, workName) {
        workManager.getWorkInfosForUniqueWorkFlow(workName)
    }.collectAsState(initial = emptyList())
    val workInfo = workInfos.firstOrNull()
    val workState = workInfo?.state
    val progress = workInfo?.progress?.getInt("progress", -1) ?: -1
    val offlineTracks by OfflineDatabase.get(context).offlineTracks().observeAll().collectAsState(initial = emptyList())
    val isDownloaded = offlineTracks.any { it.id == track.id && it.provider == track.provider }
    val isDownloading = workState == WorkInfo.State.ENQUEUED ||
        workState == WorkInfo.State.RUNNING || workState == WorkInfo.State.BLOCKED

    val enqueueDownload = {
        val request = OneTimeWorkRequestBuilder<TrackDownloadWorker>()
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setInputData(workDataOf(
                "url" to track.downloadUrl,
                "id" to track.id,
                "provider" to track.provider,
                "title" to track.title,
                "artist" to track.artist,
                "artwork" to track.artworkUrl,
                "duration" to track.durationSeconds,
                "downloadAllowed" to (track.downloadUrl != null),
                "licenseUrl" to track.licenseUrl
            )).build()
        workManager.enqueueUniqueWork(workName, ExistingWorkPolicy.KEEP, request)
    }
    val notificationPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {
        enqueueDownload()
    }
    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(Panel).clickable(onClick = onPlay).padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
        AsyncImage(track.artworkUrl, null, Modifier.size(54.dp).clip(RoundedCornerShape(11.dp)), contentScale = ContentScale.Crop)
        Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
            Text(track.title, color = Color.White, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text("${track.artist}  ·  ${track.provider}", color = Muted, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (isDownloading) {
                Text(if (progress >= 0) "Загрузка $progress%" else "Загрузка…", color = Lime, fontSize = 10.sp)
            } else if (workState == WorkInfo.State.FAILED) {
                Text("Не удалось скачать. Нажми повторить.", color = Color(0xFFFF9A8D), fontSize = 10.sp)
            } else if (isDownloaded) {
                Text("Сохранено офлайн", color = Lime, fontSize = 10.sp)
            }
        }
        if (track.provider == "Jamendo" && track.downloadUrl != null) {
            when {
                isDownloading -> IconButton(onClick = { workManager.cancelUniqueWork(workName) }) {
                    Icon(Icons.Default.Close, "Отменить загрузку", tint = Color(0xFFFF9A8D))
                }
                isDownloaded -> Icon(Icons.Default.CheckCircle, "Сохранено офлайн", tint = Lime, modifier = Modifier.padding(12.dp))
                else -> IconButton(onClick = {
                    if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                        notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
                    } else enqueueDownload()
                }) {
                    Icon(Icons.Default.Download, "Скачать офлайн", tint = Lime)
                }
            }
        }
        IconButton(onClick = onPlay) { Icon(Icons.Default.PlayCircleFilled, null, tint = Lime, modifier = Modifier.size(30.dp)) }
    }
}

@Composable
private fun MiniPlayer(track: Track, onClick: () -> Unit, onPlay: () -> Unit, playing: Boolean) {
    Row(Modifier.fillMaxWidth().background(Color(0xFF20252D)).clickable(onClick = onClick).padding(horizontal = 14.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        AsyncImage(track.artworkUrl, null, Modifier.size(42.dp).clip(RoundedCornerShape(8.dp)), contentScale = ContentScale.Crop)
        Column(Modifier.weight(1f).padding(horizontal = 10.dp)) {
            Text(track.title, color = Color.White, maxLines = 1, fontWeight = FontWeight.SemiBold)
            Text(track.artist, color = Muted, maxLines = 1, fontSize = 11.sp)
        }
        IconButton(onClick = onPlay) { Icon(if (playing) Icons.Default.Pause else Icons.Default.PlayArrow, null, tint = Lime) }
    }
}

@Composable
private fun FullPlayer(
    track: Track?,
    queue: List<Track>,
    controller: MediaController?,
    playing: Boolean,
    pause: () -> Unit,
    resume: () -> Unit,
    previous: () -> Unit,
    next: () -> Unit
) {
    var position by remember(controller) { mutableFloatStateOf(0f) }
    var duration by remember(controller) { mutableFloatStateOf(0f) }
    var showQueue by remember { mutableStateOf(false) }
    val playableQueue = remember(queue) { queue.filter { it.playable && !it.audioUrl.isNullOrBlank() }.distinctBy { "${it.provider}:${it.id}" } }
    var shuffle by remember(controller) { mutableStateOf(controller?.shuffleModeEnabled == true) }
    var repeat by remember(controller) { mutableIntStateOf(controller?.repeatMode ?: Player.REPEAT_MODE_OFF) }
    var speed by remember(controller) { mutableFloatStateOf(controller?.playbackParameters?.speed ?: 1f) }
    var volume by remember(controller) { mutableFloatStateOf(controller?.volume ?: 1f) }

    LaunchedEffect(controller, playing) {
        while (playing && controller != null) {
            position = controller.currentPosition.coerceAtLeast(0L).toFloat()
            duration = controller.duration.takeIf { it > 0L && it != androidx.media3.common.C.TIME_UNSET }?.toFloat() ?: 0f
            delay(500)
        }
    }

    if (showQueue) {
        Column(Modifier.fillMaxSize().background(Ink).padding(20.dp)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text("Очередь воспроизведения", color = Color.White, fontSize = 22.sp, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                IconButton(onClick = { showQueue = false }) { Icon(Icons.Default.Close, null, tint = Lime) }
            }
            Text("Следующие треки", color = Muted, modifier = Modifier.padding(vertical = 12.dp))
            LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(playableQueue, key = { "${it.provider}:${it.id}" }) { item ->
                    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(Panel).clickable {
                        val player = controller ?: return@clickable
                        val index = playableQueue.indexOfFirst { "${it.provider}:${it.id}" == "${item.provider}:${item.id}" }
                        if (index >= 0) player.seekTo(index, 0L)
                        player.play()
                        showQueue = false
                    }.padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
                        AsyncImage(item.artworkUrl, null, Modifier.size(44.dp).clip(RoundedCornerShape(8.dp)), contentScale = ContentScale.Crop)
                        Column(Modifier.weight(1f).padding(start = 10.dp)) {
                            Text(item.title, color = Color.White, maxLines = 1)
                            Text(item.artist, color = Muted, fontSize = 12.sp)
                        }
                        if (item.provider == track?.provider && item.id == track.id) Icon(Icons.Default.GraphicEq, null, tint = Lime)
                    }
                }
            }
        }
        return
    }

    Column(Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(Color(0xFF26312A), Ink))).padding(horizontal = 24.dp, vertical = 18.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text("СЕЙЧАС ИГРАЕТ", color = Lime, letterSpacing = 3.sp, fontSize = 11.sp, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
            IconButton(onClick = { showQueue = true }) { Icon(Icons.Default.QueueMusic, "Очередь", tint = Lime) }
        }
        Spacer(Modifier.height(12.dp))
        AsyncImage(track?.artworkUrl, null, Modifier.fillMaxWidth().weight(1f).aspectRatio(1f).clip(RoundedCornerShape(28.dp)), contentScale = ContentScale.Crop)
        Spacer(Modifier.height(18.dp))
        Text(track?.title ?: "Выбери свой трек", color = Color.White, fontSize = 23.sp, fontWeight = FontWeight.Bold, maxLines = 1)
        Text(track?.artist ?: "SONORA", color = Muted, modifier = Modifier.padding(top = 6.dp))
        Spacer(Modifier.height(16.dp))
        Slider(
            value = position.coerceIn(0f, duration.coerceAtLeast(1f)),
            onValueChange = { position = it },
            onValueChangeFinished = { controller?.seekTo(position.toLong()) },
            valueRange = 0f..duration.coerceAtLeast(1f),
            enabled = duration > 0f,
            colors = SliderDefaults.colors(thumbColor = Lime, activeTrackColor = Lime, inactiveTrackColor = Muted)
        )
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(formatTime(position.toLong()), color = Muted, fontSize = 11.sp)
            Text(formatTime(duration.toLong()), color = Muted, fontSize = 11.sp)
        }
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text("Громкость", color = Muted, fontSize = 11.sp)
            Slider(value = volume.coerceIn(0f, 1f), onValueChange = {
                volume = it
                controller?.volume = it
            }, modifier = Modifier.weight(1f), colors = SliderDefaults.colors(thumbColor = Lime, activeTrackColor = Lime))
            Text("${(volume * 100).toInt()}%", color = Muted, fontSize = 11.sp)
        }
        Spacer(Modifier.height(8.dp))
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly, verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = {
                speed = when (speed) { 1f -> 1.25f; 1.25f -> 1.5f; 1.5f -> 2f; 2f -> 0.8f; else -> 1f }
                controller?.setPlaybackSpeed(speed)
            }) { Text("${speed}×", color = Lime, fontWeight = FontWeight.Bold) }
            IconButton(onClick = {
                shuffle = !shuffle
                controller?.shuffleModeEnabled = shuffle
            }) { Icon(Icons.Default.Shuffle, "Перемешать", tint = if (shuffle) Lime else Muted) }
            IconButton(onClick = previous) { Icon(Icons.Default.SkipPrevious, null, tint = Color.White, modifier = Modifier.size(38.dp)) }
            FilledIconButton(onClick = { if (playing) pause() else resume() }, colors = IconButtonDefaults.filledIconButtonColors(containerColor = Lime, contentColor = Ink), modifier = Modifier.size(68.dp)) { Icon(if (playing) Icons.Default.Pause else Icons.Default.PlayArrow, null, modifier = Modifier.size(34.dp)) }
            IconButton(onClick = next) { Icon(Icons.Default.SkipNext, null, tint = Color.White, modifier = Modifier.size(38.dp)) }
            IconButton(onClick = {
                repeat = if (repeat == Player.REPEAT_MODE_OFF) Player.REPEAT_MODE_ALL else Player.REPEAT_MODE_OFF
                controller?.repeatMode = repeat
            }) { Icon(Icons.Default.Repeat, "Повтор", tint = if (repeat == Player.REPEAT_MODE_ALL) Lime else Muted) }
        }
    }
}

private fun formatTime(milliseconds: Long): String {
    val total = (milliseconds / 1000L).coerceAtLeast(0L)
    return "%d:%02d".format(total / 60L, total % 60L)
}

@Composable
private fun LibraryScreen(
    signedIn: Boolean,
    currentTrack: Track?,
    openProfile: () -> Unit,
    play: (Track) -> Unit
) {
    val scope = rememberCoroutineScope()
    var playlists by remember { mutableStateOf<List<SonoraApi.Playlist>>(emptyList()) }
    var selected by remember { mutableStateOf<SonoraApi.Playlist?>(null) }
    var playlistTracks by remember { mutableStateOf<List<Track>>(emptyList()) }
    var title by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }

    fun refreshPlaylists() {
        scope.launch {
            busy = true
            try {
                playlists = withContext(Dispatchers.IO) { SonoraApi.getPlaylists() }
                error = ""
            } catch (e: Exception) { error = e.message ?: "Не удалось загрузить плейлисты" }
            finally { busy = false }
        }
    }

    LaunchedEffect(signedIn) {
        if (signedIn) refreshPlaylists()
        else { playlists = emptyList(); selected = null; playlistTracks = emptyList() }
    }

    Column(Modifier.fillMaxSize().background(Ink).padding(20.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Медиатека", color = Color.White, fontSize = 28.sp, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
            if (signedIn) IconButton(onClick = { refreshPlaylists() }, enabled = !busy) {
                Icon(Icons.Default.Refresh, "Обновить", tint = Lime)
            }
        }
        if (!signedIn) {
            Text("Войди, чтобы синхронизировать плейлисты между сайтом и приложением.", color = Muted)
            Button(onClick = openProfile, colors = ButtonDefaults.buttonColors(containerColor = Lime, contentColor = Ink)) { Text("Войти в SONORA") }
        } else {
            OutlinedTextField(
                value = title, onValueChange = { title = it.take(80) },
                modifier = Modifier.fillMaxWidth(),
                label = { Text("Название нового плейлиста") }, singleLine = true,
                trailingIcon = {
                    IconButton(onClick = {
                        if (title.isNotBlank() && !busy) scope.launch {
                            busy = true
                            try {
                                val created = withContext(Dispatchers.IO) { SonoraApi.createPlaylist(title) }
                                title = ""
                                playlists = listOf(created) + playlists
                                selected = created
                                playlistTracks = emptyList()
                                error = ""
                            } catch (e: Exception) { error = e.message ?: "Не удалось создать плейлист" }
                            finally { busy = false }
                        }
                    }, enabled = title.isNotBlank() && !busy) { Icon(Icons.Default.Add, "Создать", tint = Lime) }
                }
            )
            Spacer(Modifier.height(12.dp))
            if (selected == null) {
                Text("Твои плейлисты", color = Color.White, fontSize = 18.sp, fontWeight = FontWeight.Bold)
                if (playlists.isEmpty() && !busy) Text("Пока нет плейлистов. Создай первый выше.", color = Muted, modifier = Modifier.padding(top = 10.dp))
                LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp), contentPadding = PaddingValues(vertical = 10.dp)) {
                    items(playlists, key = { it.id }) { playlist ->
                        Row(
                            Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(Panel)
                                .clickable {
                                    selected = playlist
                                    scope.launch {
                                        busy = true
                                        try { playlistTracks = withContext(Dispatchers.IO) { SonoraApi.getPlaylistTracks(playlist.id) }; error = "" }
                                        catch (e: Exception) { error = e.message ?: "Не удалось открыть плейлист" }
                                        finally { busy = false }
                                    }
                                }.padding(14.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Icon(Icons.Default.QueueMusic, null, tint = Lime, modifier = Modifier.size(28.dp))
                            Text(playlist.title, color = Color.White, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f).padding(start = 12.dp))
                            IconButton(onClick = {
                                scope.launch {
                                    busy = true
                                    try {
                                        withContext(Dispatchers.IO) { SonoraApi.deletePlaylist(playlist.id) }
                                        playlists = playlists.filterNot { it.id == playlist.id }
                                        error = ""
                                    } catch (e: Exception) { error = e.message ?: "Не удалось удалить плейлист" }
                                    finally { busy = false }
                                }
                            }, enabled = !busy) { Icon(Icons.Default.DeleteOutline, "Удалить плейлист", tint = Muted) }
                            Icon(Icons.Default.ChevronRight, null, tint = Muted)
                        }
                    }
                }
            } else {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    IconButton(onClick = { selected = null; playlistTracks = emptyList() }) { Icon(Icons.Default.ArrowBack, "Назад", tint = Lime) }
                    Text(selected!!.title, color = Color.White, fontSize = 19.sp, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                }
                if (currentTrack != null) {
                    OutlinedButton(
                        onClick = {
                            val target = selected!!
                            scope.launch {
                                busy = true
                                try {
                                    withContext(Dispatchers.IO) { SonoraApi.addTrackToPlaylist(target.id, currentTrack) }
                                    playlistTracks = withContext(Dispatchers.IO) { SonoraApi.getPlaylistTracks(target.id) }
                                    error = ""
                                } catch (e: Exception) { error = e.message ?: "Не удалось добавить трек" }
                                finally { busy = false }
                            }
                        }, enabled = !busy && (currentTrack.provider == "Audius" || currentTrack.provider == "Jamendo")
                    ) {
                        Icon(Icons.Default.Add, null); Spacer(Modifier.width(6.dp)); Text("Добавить текущий трек")
                    }
                }
                if (playlistTracks.isEmpty() && !busy) Text("В этом плейлисте пока нет доступных треков.", color = Muted, modifier = Modifier.padding(top = 10.dp))
                LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp), contentPadding = PaddingValues(vertical = 10.dp)) {
                    items(playlistTracks, key = { it.id }) { track ->
                        Row(
                            Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(Panel).padding(8.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            AsyncImage(track.artworkUrl, null, Modifier.size(48.dp).clip(RoundedCornerShape(9.dp)), contentScale = ContentScale.Crop)
                            Column(Modifier.weight(1f).padding(horizontal = 10.dp)) {
                                Text(track.title, color = Color.White, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                Text(track.artist, color = Muted, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            }
                            IconButton(onClick = { play(track) }) { Icon(Icons.Default.PlayCircleFilled, "Воспроизвести", tint = Lime) }
                            IconButton(onClick = {
                                val target = selected ?: return@IconButton
                                scope.launch {
                                    busy = true
                                    try {
                                        withContext(Dispatchers.IO) { SonoraApi.removeTrackFromPlaylist(target.id, track) }
                                        playlistTracks = playlistTracks.filterNot { it.id == track.id }
                                        error = ""
                                    } catch (e: Exception) { error = e.message ?: "Не удалось удалить трек" }
                                    finally { busy = false }
                                }
                            }, enabled = !busy) { Icon(Icons.Default.DeleteOutline, "Убрать из плейлиста", tint = Muted) }
                        }
                    }
                }
            }
            if (busy) LinearProgressIndicator(Modifier.fillMaxWidth(), color = Lime)
            if (error.isNotBlank()) Text(error, color = Color(0xFFFF9A8D), modifier = Modifier.padding(top = 8.dp))
        }
    }
}

@Composable
private fun DownloadsScreen(onPlay: (OfflineTrack) -> Unit, onDelete: (OfflineTrack) -> Unit) {
    val context = LocalContext.current
    val offline by OfflineDatabase.get(context).offlineTracks().observeAll().collectAsState(initial = emptyList())
    Column(Modifier.fillMaxSize().background(Ink).padding(22.dp)) {
        Text("Офлайн", color = Color.White, fontSize = 28.sp, fontWeight = FontWeight.Bold)
        Text(offline.size.toString() + " треков сохранено на устройстве", color = Muted, modifier = Modifier.padding(top = 6.dp, bottom = 16.dp))
        if (offline.isEmpty()) {
            Text("Здесь появятся загруженные треки. Скачивание доступно только для источников, которые явно разрешают офлайн-копирование.", color = Muted)
        } else {
            LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(offline, key = { "${it.provider}:${it.id}" }) { track ->
                    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(Panel).clickable { onPlay(track) }.padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
                        AsyncImage(track.artworkUrl, null, Modifier.size(48.dp).clip(RoundedCornerShape(9.dp)), contentScale = ContentScale.Crop)
                        Column(Modifier.weight(1f).padding(start = 12.dp)) {
                            Text(track.title, color = Color.White, maxLines = 1)
                            Text(track.artist, color = Muted, fontSize = 12.sp)
                        }
                        IconButton(onClick = { onPlay(track) }) { Icon(Icons.Default.PlayArrow, "Воспроизвести", tint = Lime) }
                        IconButton(onClick = { onDelete(track) }) { Icon(Icons.Default.DeleteOutline, "Удалить", tint = Muted) }
                    }
                }
            }
        }
    }
}

@Composable
private fun ProfileScreen(step: String, email: String, setEmail: (String) -> Unit, username: String, setUsername: (String) -> Unit, displayName: String, setDisplayName: (String) -> Unit, code: String, setCode: (String) -> Unit, busy: Boolean, message: String, onRegister: () -> Unit, onLogin: () -> Unit, onVerify: () -> Unit, onLogout: () -> Unit) {
    Column(Modifier.fillMaxSize().background(Ink).padding(22.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Профиль", color = Color.White, fontSize = 28.sp, fontWeight = FontWeight.Bold)
        when (step) {
            "signed" -> {
                Text("Ты вошёл в SONORA", color = Lime, fontSize = 18.sp)
                Text(email, color = Muted)
                OutlinedButton(onClick = onLogout) { Text("Выйти") }
            }
            "verify" -> {
                Text("Проверь почту", color = Color.White, fontSize = 20.sp)
                OutlinedTextField(code, setCode, Modifier.fillMaxWidth(), label = { Text("Код из письма") }, singleLine = true)
                Button(onClick = onVerify, enabled = !busy && code.length == 8, colors = ButtonDefaults.buttonColors(containerColor = Lime, contentColor = Ink)) { Text("Подтвердить") }
            }
            else -> {
                OutlinedTextField(email, setEmail, Modifier.fillMaxWidth(), label = { Text("Электронная почта") }, singleLine = true)
                OutlinedTextField(username, setUsername, Modifier.fillMaxWidth(), label = { Text("Имя пользователя для регистрации") }, singleLine = true)
                OutlinedTextField(displayName, setDisplayName, Modifier.fillMaxWidth(), label = { Text("Отображаемое имя") }, singleLine = true)
                Button(onClick = onRegister, enabled = !busy && email.contains("@") && username.length >= 3 && displayName.isNotBlank(), colors = ButtonDefaults.buttonColors(containerColor = Lime, contentColor = Ink), modifier = Modifier.fillMaxWidth()) { Text("Создать аккаунт") }
                OutlinedButton(onClick = onLogin, enabled = !busy && email.contains("@"), modifier = Modifier.fillMaxWidth()) { Text("У меня уже есть аккаунт") }
            }
        }
        if (busy) LinearProgressIndicator(Modifier.fillMaxWidth(), color = Lime)
        if (message.isNotBlank()) Text(message, color = Muted)
    }
}
