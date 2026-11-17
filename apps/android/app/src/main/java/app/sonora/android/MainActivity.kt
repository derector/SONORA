package app.sonora.android

import android.content.ComponentName
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.activity.compose.setContent
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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import androidx.work.*
import androidx.compose.runtime.collectAsState
import androidx.compose.ui.platform.LocalContext
import app.sonora.android.data.OfflineDatabase
import coil.compose.AsyncImage
import app.sonora.android.data.SonoraApi
import app.sonora.android.data.Track
import app.sonora.android.download.TrackDownloadWorker
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.concurrent.TimeUnit

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
    var current by remember { mutableStateOf<Track?>(null) }
    var query by remember { mutableStateOf("") }
    var email by remember { mutableStateOf(SonoraApi.email()) }
    var username by remember { mutableStateOf("") }
    var displayName by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }
    var authStep by remember { mutableStateOf(if (SonoraApi.isSignedIn()) "signed" else "welcome") }
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf("") }
    var controller by remember { mutableStateOf<MediaController?>(null) }

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
            controller = withContext(Dispatchers.IO) {
                MediaController.Builder(context, SessionToken(context, ComponentName(context, app.sonora.android.playback.PlaybackService::class.java))).buildAsync().get(10, TimeUnit.SECONDS)
            }
        } catch (_: Exception) { message = "Плеер подключится при следующем запуске" }
        loadTracks("Audius") { tracks = it }
    }

    fun play(track: Track) {
        val url = track.audioUrl ?: return
        val player = controller
        if (player == null) { message = "Плеер ещё запускается"; return }
        val metadata = MediaMetadata.Builder().setTitle(track.title).setArtist(track.artist)
            .setAlbumTitle(track.album).setArtworkUri(track.artworkUrl?.let { android.net.Uri.parse(it) }).build()
        player.setMediaItem(MediaItem.Builder().setUri(url).setMediaMetadata(metadata).build())
        player.prepare()
        player.play()
        current = track
    }

    MaterialTheme(colorScheme = darkColorScheme(
        primary = Lime, onPrimary = Ink, background = Ink, surface = Panel,
        onBackground = Color.White, onSurface = Color.White, secondary = Lime
    )) {
        Scaffold(
            containerColor = Ink,
            bottomBar = {
                Column {
                    current?.let { MiniPlayer(it, onClick = { tab = "Плеер" }, onPlay = { if (controller?.isPlaying == true) controller?.pause() else controller?.play() }, playing = controller?.isPlaying == true) }
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
                    "Поиск" -> SearchScreen(query, { query = it }, tracks, busy, message, {
                        scope.launch {
                            busy = true
                            try { tracks = withContext(Dispatchers.IO) { SonoraApi.search(query) }; message = "" }
                            catch (e: Exception) { message = e.message ?: "Ошибка поиска" }
                            finally { busy = false }
                        }
                    }, ::play)
                    "Медиатека" -> LibraryScreen(SonoraApi.isSignedIn(), { tab = "Профиль" })
                    "Загрузки" -> DownloadsScreen()
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
                        onLogout = { SonoraApi.logout(); authStep = "welcome"; message = "Вы вышли из аккаунта" }
                    )
                    else -> FullPlayer(current, controller?.isPlaying == true, { controller?.pause() }, { controller?.play() }, { controller?.seekToPrevious() }, { controller?.seekToNext() })
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
        LazyColumn(contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 18.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(tracks, key = { it.id }) { track -> TrackRow(track, { play(track) }, openPlayer) }
        }
    }
}

@Composable
private fun SearchScreen(query: String, onQuery: (String) -> Unit, tracks: List<Track>, busy: Boolean, message: String, search: () -> Unit, play: (Track) -> Unit) {
    Column(Modifier.fillMaxSize().background(Ink).padding(horizontal = 18.dp)) {
        Text("Поиск", color = Color.White, fontSize = 28.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 22.dp, bottom = 16.dp))
        OutlinedTextField(query, onQuery, Modifier.fillMaxWidth(), placeholder = { Text("Трек, исполнитель, альбом") }, singleLine = true, trailingIcon = { IconButton(onClick = search) { Icon(Icons.Default.Search, null, tint = Lime) } }, colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = Lime, unfocusedBorderColor = Panel, focusedTextColor = Color.White, unfocusedTextColor = Color.White))
        if (busy) LinearProgressIndicator(Modifier.fillMaxWidth().padding(top = 8.dp), color = Lime)
        if (message.isNotBlank()) Text(message, color = Muted, modifier = Modifier.padding(vertical = 8.dp))
        LazyColumn(contentPadding = PaddingValues(vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) { items(tracks, key = { it.id }) { TrackRow(it, { play(it) }, {}) } }
    }
}

@Composable
private fun TrackRow(track: Track, onPlay: () -> Unit, open: () -> Unit) {
    val context = LocalContext.current
    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(Panel).clickable(onClick = onPlay).padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
        AsyncImage(track.artworkUrl, null, Modifier.size(54.dp).clip(RoundedCornerShape(11.dp)), contentScale = ContentScale.Crop)
        Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
            Text(track.title, color = Color.White, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text("${track.artist}  ·  ${track.provider}", color = Muted, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        if (track.provider == "Jamendo" && track.downloadUrl != null) {
            IconButton(onClick = {
                val request = OneTimeWorkRequestBuilder<TrackDownloadWorker>()
                    .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                    .setInputData(workDataOf(
                        "url" to track.downloadUrl, "id" to track.id,
                        "provider" to track.provider, "title" to track.title,
                        "artist" to track.artist, "artwork" to track.artworkUrl,
                        "duration" to track.durationSeconds
                    )).build()
                WorkManager.getInstance(context).enqueueUniqueWork("offline-" + track.id, ExistingWorkPolicy.KEEP, request)
            }) { Icon(Icons.Default.Download, "Скачать офлайн", tint = Lime) }
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
private fun FullPlayer(track: Track?, playing: Boolean, pause: () -> Unit, resume: () -> Unit, previous: () -> Unit, next: () -> Unit) {
    Column(Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(Color(0xFF26312A), Ink))).padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
        Text("СЕЙЧАС ИГРАЕТ", color = Lime, letterSpacing = 3.sp, fontSize = 11.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(28.dp))
        AsyncImage(track?.artworkUrl, null, Modifier.fillMaxWidth().aspectRatio(1f).clip(RoundedCornerShape(28.dp)), contentScale = ContentScale.Crop)
        Spacer(Modifier.height(28.dp))
        Text(track?.title ?: "Выбери свой трек", color = Color.White, fontSize = 23.sp, fontWeight = FontWeight.Bold, maxLines = 1)
        Text(track?.artist ?: "SONORA", color = Muted, modifier = Modifier.padding(top = 6.dp))
        Spacer(Modifier.height(26.dp))
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(28.dp)) {
            IconButton(onClick = previous) { Icon(Icons.Default.SkipPrevious, null, tint = Color.White, modifier = Modifier.size(38.dp)) }
            FilledIconButton(onClick = { if (playing) pause() else resume() }, colors = IconButtonDefaults.filledIconButtonColors(containerColor = Lime, contentColor = Ink), modifier = Modifier.size(68.dp)) { Icon(if (playing) Icons.Default.Pause else Icons.Default.PlayArrow, null, modifier = Modifier.size(34.dp)) }
            IconButton(onClick = next) { Icon(Icons.Default.SkipNext, null, tint = Color.White, modifier = Modifier.size(38.dp)) }
        }
    }
}

@Composable
private fun LibraryScreen(signedIn: Boolean, openProfile: () -> Unit) {
    Column(Modifier.fillMaxSize().background(Ink).padding(22.dp)) {
        Text("Медиатека", color = Color.White, fontSize = 28.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(14.dp))
        Text(if (signedIn) "Твои плейлисты и любимые треки будут здесь." else "Войди, чтобы синхронизировать медиатеку между сайтом и приложением.", color = Muted)
        if (!signedIn) Button(onClick = openProfile, colors = ButtonDefaults.buttonColors(containerColor = Lime, contentColor = Ink)) { Text("Войти в SONORA") }
    }
}

@Composable
private fun DownloadsScreen() {
    val context = LocalContext.current
    val offline by OfflineDatabase.get(context).offlineTracks().observeAll().collectAsState(initial = emptyList())
    Column(Modifier.fillMaxSize().background(Ink).padding(22.dp)) {
        Text("Офлайн", color = Color.White, fontSize = 28.sp, fontWeight = FontWeight.Bold)
        Text(offline.size.toString() + " треков сохранено на устройстве", color = Muted, modifier = Modifier.padding(top = 6.dp, bottom = 16.dp))
        if (offline.isEmpty()) {
            Text("Здесь появятся загруженные треки. Сейчас офлайн-копии доступны только для Jamendo-записей, если API вернул отдельную ссылку скачивания и лицензию.", color = Muted)
        } else {
            LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(offline, key = { it.id }) { track ->
                    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(Panel).padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
                        AsyncImage(track.artworkUrl, null, Modifier.size(48.dp).clip(RoundedCornerShape(9.dp)), contentScale = ContentScale.Crop)
                        Column(Modifier.weight(1f).padding(start = 12.dp)) {
                            Text(track.title, color = Color.White, maxLines = 1)
                            Text(track.artist, color = Muted, fontSize = 12.sp)
                        }
                        Icon(Icons.Default.CheckCircle, null, tint = Lime)
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
