package app.sonora.android

import android.Manifest
import android.content.ComponentName
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.activity.compose.setContent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
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
import androidx.compose.animation.core.tween
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
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
import app.sonora.android.playback.PlaybackStateStore
import app.sonora.android.download.TrackDownloadWorker
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.delay
import java.io.File
import android.content.Intent
import android.widget.Toast
import app.sonora.android.ota.OtaNotifications
import app.sonora.android.ota.OtaSession
import app.sonora.android.ota.OtaUpdate
import app.sonora.android.ota.ReleaseInfo
import app.sonora.android.ota.UpdateSheet
import app.sonora.android.ui.EaseOutBrand
import app.sonora.android.ui.MotionSettings
import app.sonora.android.ui.NavTab
import app.sonora.android.ui.NavTabs
import app.sonora.android.ui.PlayPauseIcon
import app.sonora.android.ui.ProfileCenter
import app.sonora.android.ui.SeekBar
import app.sonora.android.ui.SettingsCenter
import app.sonora.android.ui.SonoraBottomBar
import app.sonora.android.ui.SonoraPrefs
import app.sonora.android.ui.Violet
import app.sonora.android.ui.popOn
import app.sonora.android.ui.staggerEnter
import app.sonora.android.ui.swipeDownToDismiss

private val Ink = Color(0xFF080910)
private val Panel = Color(0xFF141522)
private val Lime = Color(0xFFC4B5FD)
private val Muted = Color(0xFF9698AC)

class MainActivity : ComponentActivity() {
    companion object {
        // Both notification taps land inside the app: SHOW_UPDATE opens the UpdateSheet,
        // INSTALL_READY resumes straight into the system installer for the downloaded APK.
        const val ACTION_SHOW_UPDATE = "app.sonora.android.action.SHOW_UPDATE"
        const val ACTION_INSTALL_READY = "app.sonora.android.action.INSTALL_READY"
        const val EXTRA_RELEASE_TAG = "release_tag"
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        super.onCreate(savedInstanceState)
        SonoraApi.initialize(this)
        OtaNotifications.ensureChannels(this)
        // Periodic release lookup (12 h, unmetered) plus one quick pass shortly after this
        // cold start. Neither of them needs the activity to stay alive.
        OtaUpdate.schedule(this)
        OtaSession.handleIntent(this, intent)
        setContent { SonoraApp() }
    }

    // launchMode=singleTop: a notification tapped while the app is alive arrives here
    // instead of stacking a second activity on top of the first.
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        OtaSession.handleIntent(this, intent)
    }

    override fun onResume() {
        super.onResume()
        // Back from the unknown-sources grant: the APK is still remembered, so the install
        // resumes where it stopped without downloading anything again.
        OtaSession.onResumed(this)
        OtaSession.refresh(this)
    }
}

@Composable
private fun SonoraApp() {
    val context = androidx.compose.ui.platform.LocalContext.current
    val scope = rememberCoroutineScope()
    var tab by remember { mutableStateOf("Главная") }
    var tracks by remember { mutableStateOf<List<Track>>(emptyList()) }
    var activeQueue by remember { mutableStateOf<List<Track>>(emptyList()) }
    var current by remember { mutableStateOf<Track?>(null) }
    var query by remember { mutableStateOf("") }
    var searchResults by remember { mutableStateOf(SonoraApi.MusicSearch()) }
    var email by remember { mutableStateOf(SonoraApi.email()) }
    var username by remember { mutableStateOf("") }
    var displayName by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }
    var authStep by remember { mutableStateOf(if (SonoraApi.isSignedIn()) "signed" else "welcome") }
    var authMode by remember { mutableStateOf("login") }
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf("") }
    var controller by remember { mutableStateOf<MediaController?>(null) }
    var isPlaying by remember { mutableStateOf(false) }
    // Mini player: a swipe-down hides the bar until the track changes or playback restarts.
    var miniDismissed by rememberSaveable { mutableStateOf(false) }
    LaunchedEffect(current?.let { "${it.provider}:${it.id}" }, isPlaying) { if (isPlaying) miniDismissed = false }
    // Optimistic favourites set for the heart on the mini player; backed by the
    // provider favourites API, rolled back when a call fails.
    val likedIds = remember { mutableStateListOf<String>() }
    var likeTick by remember { mutableIntStateOf(0) }
    LaunchedEffect(authStep) {
        likedIds.clear()
        if (authStep == "signed") {
            try {
                likedIds.addAll(withContext(Dispatchers.IO) {
                    SonoraApi.getProviderFavorites().map { "${it.provider}:${it.id}" }
                })
            } catch (_: Exception) { }
        }
    }
    // Tab transitions slide in the direction of travel; selectTab computes it before
    // changing `tab`, so the AnimatedContent spec reads a settled value.
    var tabSwipeDirection by remember { mutableIntStateOf(1) }
    fun selectTab(next: String) {
        val order = NavTabs.map { it.key } + "Плеер"
        val from = order.indexOf(tab).takeIf { it >= 0 } ?: 0
        val to = order.indexOf(next).takeIf { it >= 0 } ?: from
        if (to != from) tabSwipeDirection = if (to > from) 1 else -1
        tab = next
    }
    fun signOut() {
        scope.launch {
            busy = true
            runCatching { withContext(Dispatchers.IO) { SonoraApi.logout() } }
            email = SonoraApi.email()
            authStep = "welcome"
            likedIds.clear()
            message = "Вы вышли из аккаунта"
            busy = false
        }
    }

    // Update-flow state: the badge in Настройки, the open sheet, the install explainer.
    // It lives outside the composable (OtaSession) because the download, the notification
    // tap and the round-trip through system Settings all outlive a single composition.
    val ota = OtaSession.state.collectAsState().value
    LaunchedEffect(ota.toast) {
        if (ota.toast.isNotBlank()) {
            Toast.makeText(context, ota.toast, Toast.LENGTH_LONG).show()
            OtaSession.consumeToast()
        }
    }

    // Android 13+ needs POST_NOTIFICATIONS before Media3 can show the playback
    // notification. Ask once per session, the first time the user actually starts
    // playback. The answer never gates playback: a denied permission only means no
    // notification, so the launcher callback intentionally does nothing and playback
    // is issued right after the request. This is separate from the existing
    // download-time request in TrackRow, which stays as it is.
    var playbackNotificationAsked by rememberSaveable { mutableStateOf(false) }
    val playbackNotificationPermission = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { /* No notification when denied; playback itself is unaffected. */ }

    fun ensurePlaybackNotificationPermission() {
        if (playbackNotificationAsked || Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        playbackNotificationAsked = true
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED
        ) return
        playbackNotificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
    }

    // One unified catalogue: the API merges every source and keeps each one's ranking,
    // so the screen neither selects nor shows where a track came from.
    fun loadCatalog(done: (List<Track>) -> Unit) {
        scope.launch {
            busy = true
            try {
                done(withContext(Dispatchers.IO) { SonoraApi.discoverCatalog() })
                message = ""
            }
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
        // MediaController is thread-confined to its application looper (the main thread).
        // Never construct it on Dispatchers.IO and never block the main thread waiting for
        // its future: attach the completion callback to the main executor instead.
        try {
            val token = SessionToken(
                context,
                ComponentName(context, app.sonora.android.playback.PlaybackService::class.java)
            )
            val future = MediaController.Builder(context, token).buildAsync()
            future.addListener({
                try {
                    controller = future.get()
                } catch (error: Exception) {
                    Log.e("SONORA_PLAYBACK", "MediaController connection failed", error)
                    message = "Плеер не смог подключиться. Перезапусти приложение."
                }
            }, ContextCompat.getMainExecutor(context))
        } catch (error: Exception) {
            Log.e("SONORA_PLAYBACK", "MediaController creation failed", error)
            message = "Плеер подключится при следующем запуске"
        }
        loadCatalog { tracks = it }
    }

    DisposableEffect(controller, tracks, activeQueue, authStep) {
        val player = controller
        if (player == null) return@DisposableEffect onDispose { }
        val knownTracks = (activeQueue + tracks).associateBy { "${it.provider}:${it.id}" }
        var previousMediaId = player.currentMediaItem?.mediaId
        var trackedMediaId = previousMediaId
        var lastPlayerPositionMs = player.currentPosition
        var listenedMs = 0L
        val completedMediaIds = mutableSetOf<String>()
        fun recordTransition(mediaId: String?, event: String) {
            val track = mediaId?.let { knownTracks[it] } ?: return
            if (!track.provider.equals("Jamendo", ignoreCase = true) || authStep != "signed") return
            if (event == "complete" && !completedMediaIds.add(mediaId)) return
            val durationMs = track.durationSeconds.coerceAtLeast(0).toLong() * 1000L
            val eventListenedMs = listenedMs.coerceAtMost(durationMs)
            scope.launch(Dispatchers.IO) {
                runCatching { SonoraApi.recordProviderHistory(track, event, eventListenedMs.toInt()) }
            }
        }
        val positionTracker = scope.launch {
            while (true) {
                delay(1000)
                val position = player.currentPosition
                if (player.isPlaying && player.currentMediaItem?.mediaId == trackedMediaId) {
                    listenedMs += (position - lastPlayerPositionMs).coerceIn(0L, 1500L)
                }
                lastPlayerPositionMs = position
            }
        }
        val listener = object : Player.Listener {
            override fun onIsPlayingChanged(playing: Boolean) { isPlaying = playing }
            override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
                val nextMediaId = mediaItem?.mediaId
                when (reason) {
                    Player.MEDIA_ITEM_TRANSITION_REASON_AUTO,
                    Player.MEDIA_ITEM_TRANSITION_REASON_REPEAT -> recordTransition(previousMediaId, "complete")
                    Player.MEDIA_ITEM_TRANSITION_REASON_SEEK -> recordTransition(previousMediaId, "skip")
                }
                previousMediaId = nextMediaId
                trackedMediaId = nextMediaId
                listenedMs = 0L
                lastPlayerPositionMs = player.currentPosition
                val mediaId = nextMediaId ?: return
                completedMediaIds.remove(mediaId)
                knownTracks[mediaId]?.let { current = it }
            }
            override fun onPlaybackStateChanged(playbackState: Int) {
                if (playbackState == Player.STATE_ENDED) recordTransition(previousMediaId, "complete")
            }
            override fun onPlayerError(error: PlaybackException) {
                Log.e("SONORA_PLAYBACK", "Media3 could not play the current track", error)
                message = "Не удалось воспроизвести трек. Попробуйте другой источник."
                Toast.makeText(context, message, Toast.LENGTH_LONG).show()
            }
        }
        player.addListener(listener)
        isPlaying = player.isPlaying
        onDispose {
            positionTracker.cancel()
            player.removeListener(listener)
        }
    }

    fun isSupportedAudioUrl(value: String): Boolean = runCatching {
        val uri = android.net.Uri.parse(value)
        when (uri.scheme?.lowercase()) {
            "https", "http" -> !uri.host.isNullOrBlank()
            "file", "content" -> true
            else -> false
        }
    }.getOrDefault(false)

    fun mediaItem(track: Track, url: String): MediaItem {
        val metadata = MediaMetadata.Builder().setTitle(track.title).setArtist(track.artist)
            .setAlbumTitle(track.album).setArtworkUri(track.artworkUrl?.let { android.net.Uri.parse(it) }).build()
        return MediaItem.Builder().setMediaId("${track.provider}:${track.id}").setUri(url).setMediaMetadata(metadata).build()
    }

    LaunchedEffect(controller) {
        val player = controller ?: return@LaunchedEffect
        val saved = withContext(Dispatchers.IO) { PlaybackStateStore.load(context) }
            ?: return@LaunchedEffect
        // ── Restore ownership ──────────────────────────────────────────────────────
        // PlaybackService.onPlaybackResumption and this effect both know how to rebuild
        // the persisted queue, so on a cold start they could run at the same time and
        // prepare the queue twice (playhead reset, duplicated history events).
        //
        // Decision: the service owns restoration whenever it has already done it, and
        // that case is detected conservatively, without restructuring anything:
        //   1. the one-shot handoff marker the service writes right before it hands the
        //      resumed items to Media3 (read here and cleared, so it can never be reused
        //      by a later restore), and
        //   2. an already populated controller timeline, which additionally makes this
        //      path idempotent across activity recreation (rotation, relaunch on top of
        //      a still-playing service).
        //
        // When either signal is present MainActivity only mirrors the restored queue into
        // its UI state and returns; it never re-issues setMediaItems/prepare/play.
        // Otherwise MainActivity owns the restore below, exactly as before.
        val restoredByService = withContext(Dispatchers.IO) {
            PlaybackStateStore.consumeQueueResumedByService(context)
        } || player.mediaItemCount > 0
        if (restoredByService) {
            // Mirror exactly what Media3 restored, joined with the persisted metadata.
            // Rebuilding from saved.tracks would disagree with the player whenever the
            // service dropped an unresolvable item, and the periodic state save below
            // would then write that mismatch back to disk.
            val savedByMediaId = saved.tracks.associateBy { "${it.provider}:${it.id}" }
            val resumedQueue = (0 until player.mediaItemCount)
                .mapNotNull { savedByMediaId[player.getMediaItemAt(it).mediaId] }
            activeQueue = resumedQueue.ifEmpty { saved.tracks }
            current = player.currentMediaItem?.mediaId?.let(savedByMediaId::get) ?: activeQueue.firstOrNull()
            return@LaunchedEffect
        }
        val resolved = withContext(Dispatchers.IO) {
            saved.tracks.mapNotNull { savedTrack ->
                if (savedTrack.audioUrl?.startsWith("file:") == true) {
                    savedTrack.takeIf { savedTrack.audioUrl.let { uri ->
                        runCatching { File(android.net.Uri.parse(uri).path.orEmpty()).isFile }.getOrDefault(false)
                    } }
                } else {
                    runCatching {
                        SonoraApi.resolveTrack(savedTrack.provider, savedTrack.providerTrackId)
                    }.getOrNull()
                }
            }.filter { it.playable && !it.audioUrl.isNullOrBlank() }
        }
        if (resolved.isEmpty()) {
            PlaybackStateStore.clear(context)
            return@LaunchedEffect
        }
        val savedCurrent = saved.tracks.getOrNull(saved.currentIndex)
        val restoredIndex = savedCurrent?.let { target ->
            resolved.indexOfFirst {
                it.provider == target.provider && it.providerTrackId == target.providerTrackId
            }
        }?.takeIf { it >= 0 } ?: 0
        activeQueue = resolved
        current = resolved[restoredIndex]
        player.setMediaItems(
            resolved.map { mediaItem(it, it.audioUrl!!) },
            restoredIndex,
            saved.positionMs
        )
        player.shuffleModeEnabled = saved.shuffleEnabled
        player.repeatMode = saved.repeatMode
        player.prepare()
        if (saved.playWhenReady) player.play()
    }

    LaunchedEffect(controller, activeQueue) {
        val player = controller ?: return@LaunchedEffect
        if (activeQueue.isEmpty()) return@LaunchedEffect
        while (true) {
            // Read every MediaController property on its application (main) looper.
            // Only the disk write is dispatched to IO. Reading these properties inside
            // withContext(IO) caused Media3's verifyApplicationThread crash on Xiaomi.
            if (player.mediaItemCount > 0) {
                val queueSnapshot = activeQueue.toList()
                val currentIndex = player.currentMediaItemIndex
                val positionMs = player.currentPosition
                val shuffleEnabled = player.shuffleModeEnabled
                val repeatMode = player.repeatMode
                val playWhenReady = player.playWhenReady
                withContext(Dispatchers.IO) {
                    PlaybackStateStore.save(
                        context = context,
                        queue = queueSnapshot,
                        currentIndex = currentIndex,
                        positionMs = positionMs,
                        shuffleEnabled = shuffleEnabled,
                        repeatMode = repeatMode,
                        playWhenReady = playWhenReady
                    )
                }
            }
            delay(2_000)
        }
    }

    fun startTrack(track: Track, local: Boolean = false) {
        val player = controller
        if (player == null) { message = "Плеер ещё запускается"; return }
        val url = track.audioUrl
        if (url.isNullOrBlank()) { message = "У этого трека нет доступного источника"; return }
        if (!isSupportedAudioUrl(url)) {
            message = "У этого трека неподдерживаемый адрес аудиоисточника"
            Toast.makeText(context, message, Toast.LENGTH_LONG).show()
            return
        }
        try {
            // First user-initiated playback of the session: make sure the media
            // notification can be shown. Non-blocking by design; the request is a no-op
            // on Android 12 and older and is only ever issued once.
            ensurePlaybackNotificationPermission()
            if (local) {
                activeQueue = listOf(track)
                player.setMediaItem(mediaItem(track, url))
                player.prepare()
                player.play()
                current = track
                return
            }
            val queue = (tracks.filter { it.playable && it.audioUrl?.let(::isSupportedAudioUrl) == true } + track)
                .distinctBy { "${it.provider}:${it.id}" }
            activeQueue = queue
            val selectedIndex = queue.indexOfFirst { "${it.provider}:${it.id}" == "${track.provider}:${track.id}" }.coerceAtLeast(0)
            player.setMediaItems(queue.map { mediaItem(it, it.audioUrl!!) }, selectedIndex, 0L)
            player.prepare()
            player.play()
            current = track
            if (track.provider.equals("Jamendo", ignoreCase = true) && authStep == "signed") {
                scope.launch(Dispatchers.IO) {
                    runCatching { SonoraApi.recordProviderHistory(track, "play", 0) }
                }
            }
        } catch (error: Exception) {
            Log.e("SONORA_PLAYBACK", "Failed to start ${track.provider}:${track.id}", error)
            message = "Не удалось запустить воспроизведение. Попробуйте другой трек."
            Toast.makeText(context, message, Toast.LENGTH_LONG).show()
        }
    }

    fun play(track: Track) = startTrack(track)

    fun toggleLike(track: Track) {
        if (authStep != "signed") {
            Toast.makeText(context, "Войдите, чтобы сохранять избранное", Toast.LENGTH_SHORT).show()
            return
        }
        val key = "${track.provider}:${track.id}"
        val wasLiked = likedIds.remove(key)
        if (!wasLiked) likedIds.add(key)
        likeTick++
        scope.launch {
            val ok = withContext(Dispatchers.IO) {
                runCatching {
                    if (wasLiked) SonoraApi.removeProviderFavorite(track)
                    else SonoraApi.addProviderFavorite(track)
                }.isSuccess
            }
            if (!ok) {
                if (wasLiked) {
                    if (!likedIds.contains(key)) likedIds.add(key)
                } else likedIds.remove(key)
                likeTick++
                Toast.makeText(context, "Не удалось сохранить избранное. Попробуйте снова", Toast.LENGTH_SHORT).show()
            }
        }
    }

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
                    // The mini player slides up when playback starts and can be swiped
                    // down to dismiss; tapping it opens the full player again.
                    AnimatedVisibility(
                        visible = current != null && !miniDismissed,
                        enter = slideInVertically(animationSpec = tween(MotionSettings.duration(260), easing = EaseOutBrand)) { it } +
                            fadeIn(animationSpec = tween(MotionSettings.duration(200))),
                        exit = fadeOut(animationSpec = tween(0)),
                        label = "mini-player"
                    ) {
                        val track = current
                        if (track != null) {
                            MiniPlayer(
                                track = track,
                                playing = controller?.isPlaying == true,
                                liked = likedIds.contains("${track.provider}:${track.id}"),
                                likeTick = likeTick,
                                onClick = { selectTab("Плеер") },
                                onPlay = { if (isPlaying) controller?.pause() else controller?.play() },
                                onLike = { toggleLike(track) },
                                onDismiss = { miniDismissed = true }
                            )
                        }
                    }
                    SonoraBottomBar(
                        tabs = NavTabs,
                        selectedKey = tab,
                        onSelect = { selectTab(it) }
                    )
                }
            }
        ) { padding ->
            AnimatedContent(
                tab,
                modifier = Modifier.padding(padding).fillMaxSize(),
                transitionSpec = {
                    if (MotionSettings.enabled) {
                        val dir = tabSwipeDirection
                        (slideInHorizontally(animationSpec = tween(220, easing = EaseOutBrand)) { w -> dir * w / 5 } +
                            fadeIn(animationSpec = tween(220))) togetherWith
                            (slideOutHorizontally(animationSpec = tween(220, easing = EaseOutBrand)) { w -> -dir * w / 5 } +
                                fadeOut(animationSpec = tween(160)))
                    } else {
                        fadeIn(animationSpec = tween(0)) togetherWith fadeOut(animationSpec = tween(0))
                    }
                },
                label = "tab"
            ) { screen ->
                when (screen) {
                    "Главная" -> DiscoverScreen(tracks, busy, message, { loadCatalog { tracks = it } }, ::play, { selectTab("Плеер") }, { selectTab("Поиск") })
                    "Поиск" -> SearchScreen(query, { value -> query = value; searchResults = SonoraApi.MusicSearch(); message = "" }, searchResults, busy, message, {
                        val term = query.trim()
                        if (term.isBlank()) {
                            searchResults = SonoraApi.MusicSearch()
                            message = "Введите название трека или исполнителя"
                        } else {
                            scope.launch {
                                busy = true
                                message = ""
                                try {
                                    val results = withContext(Dispatchers.IO) { SonoraApi.search(term) }
                                    if (query.trim() == term) searchResults = results
                                } catch (e: Exception) {
                                    if (query.trim() == term) {
                                        searchResults = SonoraApi.MusicSearch()
                                        message = e.message ?: "Ошибка поиска"
                                    }
                                }
                                finally { busy = false }
                            }
                        }
                    }, ::play)
                    "Медиатека" -> LibraryScreen(
                        signedIn = authStep == "signed",
                        currentTrack = current,
                        openProfile = { selectTab("Профиль") },
                        play = ::play
                    )
                    "Загрузки" -> DownloadsScreen(onPlay = ::playOffline, onDelete = { item ->
                        scope.launch(Dispatchers.IO) {
                            runCatching { File(item.localPath).delete() }
                            OfflineDatabase.get(context).offlineTracks().delete(item.provider, item.id)
                        }
                    })
                    "Настройки" -> SettingsCenter(
                        update = ota.release,
                        checking = ota.checking,
                        lastCheckedAt = OtaUpdate.lastCheckedAt(context),
                        notificationsAllowed = ota.notificationsAllowed,
                        signedIn = authStep == "signed",
                        email = email,
                        onCheck = { OtaSession.checkNow(context) },
                        onOpenUpdate = { OtaSession.openSheet(context) },
                        onOpenProfile = { selectTab("Профиль") },
                        onSignOut = { signOut() },
                        // Live effects: SettingsCenter stores the switch, these callbacks
                        // change behaviour while the app is running.
                        onNonStopChanged = { enabled ->
                            controller?.repeatMode =
                                if (enabled) Player.REPEAT_MODE_ALL else Player.REPEAT_MODE_OFF
                        },
                        onQualityChanged = { _ ->
                            SonoraApi.qualityKbps = SonoraPrefs.qualityKbps(context, cellular = false)
                        }
                    )
                    // Auth gate: the account surface is only shown once a session exists;
                    // before that the sign-in form stays as the entry point.
                    "Профиль" -> if (authStep == "signed") {
                        ProfileCenter(
                            email = email,
                            onLogout = { signOut() },
                            onOpenLibrary = { selectTab("Медиатека") },
                            play = ::play
                        )
                    } else ProfileScreen(authStep, authMode, { authMode = it }, email, { email = it }, username, { username = it }, displayName, { displayName = it }, code, { code = it }, busy, message,
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
                    else -> FullPlayer(
                        track = current,
                        queue = activeQueue,
                        controller = controller,
                        playing = controller?.isPlaying == true,
                        liked = current?.let { likedIds.contains("${it.provider}:${it.id}") } == true,
                        onLike = { current?.let(::toggleLike) },
                        pause = { controller?.pause() },
                        resume = { controller?.play() },
                        previous = { controller?.seekToPrevious() },
                        next = { controller?.seekToNext() }
                    )
                }
            }

            // ── In-app update surface ────────────────────────────────────────────────
            // The sheet is where an update is explained, downloaded and installed. It opens
            // from the notification, from the settings row, or from the manual check itself.
            if (ota.sheetVisible) {
                ota.release?.let { release ->
                    UpdateSheet(
                        release = release,
                        onNotNow = { OtaSession.dismissRelease(context) },
                        onUpdate = { OtaSession.startUpdate(context) },
                        onDownloadAgain = { OtaSession.startUpdate(context) },
                        onCancelDownload = { OtaSession.cancelDownload(context) },
                        onInstall = { file -> OtaSession.install(context, file) },
                        onDismiss = { OtaSession.closeSheet() }
                    )
                }
            }
            if (ota.needsInstallPermission) {
                // The one unavoidable system screen, so it is explained before it is opened.
                AlertDialog(
                    onDismissRequest = { OtaSession.declineInstallSettings() },
                    containerColor = Panel,
                    title = { Text("Разрешить установку", color = Color.White) },
                    text = {
                        Text(
                            "SONORA скачала обновление и готова установить его. Android требует " +
                                "разрешить установку из неизвестных источников — это единственный " +
                                "системный экран, дальше всё пройдёт в приложении.",
                            color = Muted
                        )
                    },
                    confirmButton = {
                        TextButton(onClick = { OtaSession.openInstallSettings(context) }) { Text("Открыть настройки", color = Lime) }
                    },
                    dismissButton = {
                        TextButton(onClick = { OtaSession.declineInstallSettings() }) { Text("Не сейчас", color = Muted) }
                    }
                )
            }
        }
    }
}


@Composable
private fun DiscoverScreen(tracks: List<Track>, busy: Boolean, message: String, refresh: () -> Unit, play: (Track) -> Unit, openPlayer: () -> Unit, openSearch: () -> Unit) {
    Column(Modifier.fillMaxSize().background(Ink)) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 22.dp, vertical = 18.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("SONORA", color = Lime, fontSize = 13.sp, fontWeight = FontWeight.Black, letterSpacing = 4.sp)
                Text("Твоя музыка. Твой поток.", color = Color.White, fontSize = 25.sp, fontWeight = FontWeight.Bold)
            }
            Box(Modifier.size(42.dp).clip(CircleShape).background(Brush.linearGradient(listOf(Lime, Color(0xFF7DD3FC)))), contentAlignment = Alignment.Center) { Text("S", color = Ink, fontWeight = FontWeight.Black, fontSize = 23.sp) }
        }
        Box(
            Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)
                .clip(RoundedCornerShape(26.dp))
                .background(Brush.linearGradient(listOf(Color(0xFF33254E), Color(0xFF1C233A), Color(0xFF102A35))))
                .clickable(onClick = openSearch).padding(20.dp)
        ) {
            Box(Modifier.align(Alignment.TopEnd).size(116.dp).offset(x = 22.dp, y = (-28).dp)
                .clip(CircleShape).background(Color.White.copy(alpha = 0.045f)))
            Column(Modifier.fillMaxWidth()) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Default.AutoAwesome, contentDescription = null, tint = Color(0xFFD8CCFF), modifier = Modifier.size(16.dp))
                    Spacer(Modifier.width(7.dp))
                    Text("SONORA DISCOVERY", color = Color(0xFFD8CCFF), fontSize = 10.sp, fontWeight = FontWeight.Bold, letterSpacing = 2.sp)
                }
                Text("Найди свой звук", color = Color.White, fontSize = 24.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 12.dp))
                Text("Музыка из открытых каталогов. Твоя коллекция и твой поток.", color = Color(0xFFD0CDDC), fontSize = 12.sp, lineHeight = 18.sp, modifier = Modifier.padding(top = 5.dp))
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 15.dp)) {
                    Text("Открыть поиск", color = Color(0xFF171323), fontSize = 12.sp, fontWeight = FontWeight.Bold,
                        modifier = Modifier.clip(RoundedCornerShape(50)).background(Color(0xFFD8CCFF)).clickable(onClick = openSearch).padding(horizontal = 15.dp, vertical = 9.dp))
                    Spacer(Modifier.width(10.dp))
                    Text("Единый каталог", color = Color.White.copy(alpha = 0.72f), fontSize = 10.sp)
                }
            }
        }
        Text("Тебе может понравиться", Modifier.padding(start = 22.dp, top = 24.dp, bottom = 10.dp), color = Color.White, fontSize = 19.sp, fontWeight = FontWeight.Bold)
        if (busy) LinearProgressIndicator(Modifier.fillMaxWidth(), color = Lime, trackColor = Panel)
        if (message.isNotBlank()) Text(message, Modifier.padding(horizontal = 22.dp, vertical = 8.dp), color = Muted)
        if (!busy && tracks.isEmpty() && message.isBlank()) {
            Column(
                Modifier.fillMaxWidth().padding(horizontal = 22.dp, vertical = 20.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Text("Пока нет доступных треков", color = Color.White, fontWeight = FontWeight.SemiBold)
                Text(
                    "Проверьте подключение и попробуйте обновить каталог.",
                    color = Muted,
                    modifier = Modifier.padding(top = 6.dp, bottom = 14.dp)
                )
                Button(
                    onClick = refresh,
                    colors = ButtonDefaults.buttonColors(containerColor = Lime, contentColor = Ink)
                ) {
                    Icon(Icons.Default.Refresh, contentDescription = null)
                    Spacer(Modifier.width(8.dp))
                    Text("Повторить")
                }
            }
        }
        LazyColumn(contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 18.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            itemsIndexed(tracks, key = { _, track -> track.provider + ":" + track.id }) { index, track -> TrackRow(track, index, { play(track) }, openPlayer) }
        }
    }
}

@Composable
private fun SearchScreen(query: String, onQuery: (String) -> Unit, results: SonoraApi.MusicSearch, busy: Boolean, message: String, search: () -> Unit, play: (Track) -> Unit) {
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
        LazyColumn(contentPadding = PaddingValues(vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            itemsIndexed(items = results.tracks, key = { _: Int, item: Track -> item.provider + ":" + item.id }) { index, track ->
                TrackRow(track, index, { play(track) }, {})
            }
            if (results.matches.isNotEmpty()) {
                item {
                    Text("Совпадения в каталогах", color = Color.White, fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.padding(top = 12.dp))
                }
                items(results.matches, key = { "catalog:${it.provider}:${it.id}" }) { match ->
                    RecordingMatchCard(match, play)
                }
            }
        }
    }
}

@Composable
private fun RecordingMatchCard(match: SonoraApi.CatalogMatch, play: (Track) -> Unit) {
    val uriHandler = androidx.compose.ui.platform.LocalUriHandler.current
    val scope = rememberCoroutineScope()
    var finding by remember(match) { mutableStateOf(false) }
    var status by remember(match) { mutableStateOf("") }
    var candidate by remember(match) { mutableStateOf<Track?>(null) }
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(Panel).padding(14.dp)) {
        Row(
            Modifier.fillMaxWidth().clickable { runCatching { uriHandler.openUri(match.url) } },
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(Modifier.weight(1f)) {
                Text(match.title, color = Color.White, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(listOf(match.artist, match.provider).filter { it.isNotBlank() }.joinToString(" · "),
                    color = Muted, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            Text("Источник ↗", color = Lime, fontSize = 12.sp)
        }
        val found = candidate
        if (found == null) {
            TextButton(enabled = !finding, onClick = {
                finding = true
                status = ""
                scope.launch {
                    try {
                        candidate = withContext(Dispatchers.IO) { SonoraApi.findPlayableVersion(match) }
                        if (candidate == null) status = "Доступная версия не найдена."
                    } catch (cancelled: kotlinx.coroutines.CancellationException) {
                        throw cancelled
                    } catch (_: Exception) {
                        status = "Не удалось выполнить поиск трека."
                    } finally {
                        finding = false
                    }
                }
            }) { Text(if (finding) "Ищем доступную версию…" else "Найти доступную версию", color = Lime) }
            if (status.isNotBlank()) Text(status, color = Muted, fontSize = 12.sp)
        } else {
            Spacer(Modifier.height(8.dp))
            Text("Возможное совпадение · ${found.title} · ${found.artist} · ${found.provider}", color = Muted, fontSize = 12.sp)
            TextButton(onClick = { play(found) }) { Text("Воспроизвести", color = Lime) }
        }
    }
}

@Composable
private fun TrackRow(track: Track, index: Int = 0, onPlay: () -> Unit, open: () -> Unit) {
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
            .setConstraints(Constraints.Builder().setRequiredNetworkType(
                if (SonoraPrefs.bool(context, SonoraPrefs.DOWNLOAD_ON_CELLULAR, false) &&
                    !SonoraPrefs.bool(context, SonoraPrefs.DATA_SAVER, false)) NetworkType.CONNECTED
                else NetworkType.UNMETERED
            ).build())
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
    // The provider field stays internal (routing, resolve, download eligibility); a row
    // only ever shows title, artist, artwork and duration. Tracks whose source cannot be
    // delivered (for example a cleartext stream URL rejected by the manifest policy) are
    // labelled and tinted as unavailable instead of offering a playback attempt.
    val available = track.playable && !track.audioUrl.isNullOrBlank()
    Row(
        Modifier.fillMaxWidth().staggerEnter(index)
            .clip(RoundedCornerShape(16.dp)).background(Panel).clickable(onClick = onPlay).padding(10.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        AsyncImage(track.artworkUrl, null, Modifier.size(54.dp).clip(RoundedCornerShape(11.dp)), contentScale = ContentScale.Crop)
        Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
            Text(track.title, color = Color.White, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(track.artist, color = Muted, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (isDownloading) {
                Text(if (progress >= 0) "Загрузка $progress%" else "Загрузка…", color = Lime, fontSize = 10.sp)
            } else if (workState == WorkInfo.State.FAILED) {
                Text("Не удалось скачать. Нажми повторить.", color = Color(0xFFFF9A8D), fontSize = 10.sp)
            } else if (isDownloaded) {
                Text("Сохранено офлайн", color = Lime, fontSize = 10.sp)
            } else if (!available) {
                Text("Недоступно для воспроизведения", color = Muted, fontSize = 10.sp)
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
        IconButton(onClick = onPlay) {
            Icon(Icons.Default.PlayCircleFilled, null, tint = if (available) Lime else Muted, modifier = Modifier.size(30.dp))
        }
    }
}

@Composable
private fun MiniPlayer(
    track: Track,
    playing: Boolean,
    liked: Boolean,
    likeTick: Int,
    onClick: () -> Unit,
    onPlay: () -> Unit,
    onLike: () -> Unit,
    onDismiss: () -> Unit
) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp, vertical = 5.dp)
            // Declared before the clickable in the chain, so a vertical pull steals the
            // gesture and dismisses; a plain tap still opens the full player.
            .swipeDownToDismiss(onDismiss = onDismiss)
            .clip(RoundedCornerShape(18.dp))
            .background(Brush.horizontalGradient(listOf(Color(0xFF40325D), Color(0xFF1C2032), Color(0xFF20343C))))
            .border(1.dp, Color(0x39E1D6FF), RoundedCornerShape(18.dp))
            .clickable(onClick = onClick)
            .heightIn(min = 68.dp)
            .padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        AsyncImage(track.artworkUrl, null, Modifier.size(48.dp).clip(RoundedCornerShape(10.dp)), contentScale = ContentScale.Crop)
        Column(Modifier.weight(1f).padding(horizontal = 10.dp)) {
            Text(track.title, color = Color.White, maxLines = 1, overflow = TextOverflow.Ellipsis, fontWeight = FontWeight.SemiBold)
            Text(track.artist, color = Muted, maxLines = 1, overflow = TextOverflow.Ellipsis, fontSize = 11.sp)
        }
        IconButton(onClick = onLike) {
            Icon(
                if (liked) Icons.Default.Favorite else Icons.Default.FavoriteBorder,
                if (liked) "Убрать из избранного" else "В избранное",
                tint = if (liked) app.sonora.android.ui.Violet else Muted,
                modifier = Modifier.size(22.dp).popOn(likeTick)
            )
        }
        IconButton(onClick = onPlay) { PlayPauseIcon(playing = playing, tint = Lime) }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun FullPlayer(
    track: Track?,
    queue: List<Track>,
    controller: MediaController?,
    playing: Boolean,
    liked: Boolean,
    onLike: () -> Unit,
    pause: () -> Unit,
    resume: () -> Unit,
    previous: () -> Unit,
    next: () -> Unit
) {
    var position by remember(controller) { mutableFloatStateOf(0f) }
    var duration by remember(controller) { mutableFloatStateOf(0f) }
    var showQueue by remember { mutableStateOf(false) }
    var showTrackInfo by remember { mutableStateOf(false) }
    val playableQueue = remember(queue) { queue.filter { it.playable && !it.audioUrl.isNullOrBlank() }.distinctBy { "${it.provider}:${it.id}" } }
    var shuffle by remember(controller) { mutableStateOf(controller?.shuffleModeEnabled == true) }
    var repeat by remember(controller) { mutableIntStateOf(controller?.repeatMode ?: Player.REPEAT_MODE_OFF) }
    val context = LocalContext.current
    val speedPreferences = remember(context) { context.getSharedPreferences("sonora-player-settings", 0) }
    var speed by remember(controller, context) {
        mutableFloatStateOf(
            speedPreferences.getFloat("playback_speed", 1f).takeIf { it == 1f || it == 1.25f || it == 0.8f } ?: 1f
        )
    }
    var volume by remember(controller) { mutableFloatStateOf(controller?.volume ?: 1f) }

    // Attribution for an open-licensed track is a details-sheet concern only.
    val openLink: (String) -> Unit = { link ->
        runCatching {
            context.startActivity(
                Intent(Intent.ACTION_VIEW, android.net.Uri.parse(link)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            )
        }
    }

    LaunchedEffect(controller) { controller?.setPlaybackSpeed(speed) }

    // One Media3 clock drives both the progress bar and its time labels. SeekBar keeps
    // the finger position authoritative during a drag and seeks once on release.
    LaunchedEffect(controller, track) {
        val player = controller ?: return@LaunchedEffect
        fun syncTimeline() {
            val reportedDuration = player.duration
            val metadataDuration = (track?.durationSeconds ?: 0).coerceAtLeast(0) * 1000L
            val resolvedDuration = if (
                reportedDuration > 0L && reportedDuration != androidx.media3.common.C.TIME_UNSET
            ) reportedDuration else metadataDuration
            duration = resolvedDuration.toFloat()
            position = player.currentPosition.coerceAtLeast(0L)
                .coerceAtMost(resolvedDuration.takeIf { it > 0L } ?: Long.MAX_VALUE).toFloat()
        }
        val listener = object : Player.Listener {
            override fun onEvents(player: Player, events: Player.Events) { syncTimeline() }
        }
        player.addListener(listener)
        syncTimeline()
        try {
            while (true) {
                syncTimeline()
                delay(500)
            }
        } finally {
            player.removeListener(listener)
        }
    }

    if (showQueue) {
        ModalBottomSheet(
            onDismissRequest = { showQueue = false },
            containerColor = Color(0xFF151329),
            contentColor = Color.White,
            shape = RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp)
        ) {
            Column(Modifier.fillMaxWidth().navigationBarsPadding().padding(horizontal = 20.dp).heightIn(max = 560.dp)) {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text("Твоя очередь", color = Color.White, fontSize = 22.sp, fontWeight = FontWeight.Bold)
                        Text("${playableQueue.size} треков", color = Muted, fontSize = 12.sp, modifier = Modifier.padding(top = 3.dp))
                    }
                    IconButton(onClick = { showQueue = false }) { Icon(Icons.Default.Close, "Закрыть", tint = Muted) }
                }
                LazyColumn(
                    modifier = Modifier.padding(top = 14.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                    contentPadding = PaddingValues(bottom = 22.dp)
                ) {
                    items(playableQueue, key = { "${it.provider}:${it.id}" }) { item ->
                        val selected = item.provider == track?.provider && item.id == track?.id
                        Row(
                            Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp))
                                .background(if (selected) Color(0xFF2B2050) else Panel)
                                .clickable {
                                    val player = controller ?: return@clickable
                                    val index = (0 until player.mediaItemCount).firstOrNull {
                                        player.getMediaItemAt(it).mediaId == "${item.provider}:${item.id}"
                                    } ?: -1
                                    if (index >= 0) player.seekTo(index, 0L)
                                    player.play()
                                    showQueue = false
                                }
                                .padding(10.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            AsyncImage(item.artworkUrl, null, Modifier.size(46.dp).clip(RoundedCornerShape(10.dp)), contentScale = ContentScale.Crop)
                            Column(Modifier.weight(1f).padding(start = 11.dp)) {
                                Text(item.title, color = Color.White, maxLines = 1, overflow = TextOverflow.Ellipsis, fontWeight = if (selected) FontWeight.Bold else FontWeight.Medium)
                                Text(item.artist, color = Muted, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            }
                            if (selected) Icon(Icons.Default.GraphicEq, "Сейчас играет", tint = Lime, modifier = Modifier.padding(start = 8.dp))
                        }
                    }
                }
            }
        }
    }

    if (showTrackInfo && track != null) {
        val details = track
        ModalBottomSheet(
            onDismissRequest = { showTrackInfo = false },
            containerColor = Color(0xFF151329),
            contentColor = Color.White,
            shape = RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp)
        ) {
            Column(
                Modifier.fillMaxWidth().navigationBarsPadding().verticalScroll(rememberScrollState())
                    .padding(horizontal = 22.dp).padding(bottom = 22.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Text("О треке", color = Color.White, fontSize = 22.sp, fontWeight = FontWeight.Bold)
                Text(details.title, color = Color.White, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                Text(details.artist, color = Muted, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                details.album?.takeIf { it.isNotBlank() }?.let { Text(it, color = Muted, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis) }
                HorizontalDivider(color = Color.White.copy(alpha = 0.08f), modifier = Modifier.padding(vertical = 6.dp))
                Text("Громкость", color = Muted, fontSize = 12.sp)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Default.VolumeDown, null, tint = Muted, modifier = Modifier.size(18.dp))
                    Slider(value = volume.coerceIn(0f, 1f), onValueChange = {
                        volume = it
                        controller?.volume = it
                    }, modifier = Modifier.weight(1f), colors = SliderDefaults.colors(thumbColor = Violet, activeTrackColor = Violet))
                    Text("${(volume * 100).toInt()}%", color = Muted, fontSize = 11.sp)
                }
                Text("Скорость", color = Muted, fontSize = 12.sp, modifier = Modifier.padding(top = 4.dp))
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf("0,8×" to 0.8f, "1×" to 1f, "1,25×" to 1.25f).forEach { (label, value) ->
                        TextButton(
                            onClick = {
                                speed = value
                                speedPreferences.edit().putFloat("playback_speed", value).apply()
                                controller?.setPlaybackSpeed(value)
                            },
                            modifier = Modifier.weight(1f),
                            colors = ButtonDefaults.textButtonColors(
                                containerColor = if (speed == value) Violet else Panel,
                                contentColor = if (speed == value) Ink else Muted
                            )
                        ) { Text(label, fontWeight = if (speed == value) FontWeight.Bold else FontWeight.Medium) }
                    }
                }
                // Attribution stays deliberately inside the track-info/legal area.
                details.licenseUrl?.let { license ->
                    Text("Лицензия и атрибуция", color = Color.White, fontSize = 12.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 8.dp))
                    Text(license, color = Violet, fontSize = 12.sp, maxLines = 2, overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.clip(RoundedCornerShape(8.dp)).clickable { openLink(license) }.padding(vertical = 4.dp))
                }
                details.sourceUrl?.let { source ->
                    Text("Страница трека", color = Color.White, fontSize = 12.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 2.dp))
                    Text(source, color = Violet, fontSize = 12.sp, maxLines = 2, overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.clip(RoundedCornerShape(8.dp)).clickable { openLink(source) }.padding(vertical = 4.dp))
                }
            }
        }
    }

    Column(
        Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(Color(0xFF21183D), Color(0xFF11111B), Ink)))
            .statusBarsPadding().navigationBarsPadding().verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp, vertical = 12.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("СЕЙЧАС ИГРАЕТ", color = Violet, letterSpacing = 2.5.sp, fontSize = 10.sp, fontWeight = FontWeight.Bold)
                Text(if (track == null) "SONORA" else "Твой поток", color = Muted, fontSize = 12.sp, modifier = Modifier.padding(top = 3.dp))
            }
            IconButton(onClick = { showQueue = true }, enabled = playableQueue.isNotEmpty()) {
                Icon(Icons.Default.QueueMusic, "Открыть очередь", tint = if (playableQueue.isNotEmpty()) Color.White else Muted)
            }
            IconButton(onClick = { showTrackInfo = true }, enabled = track != null) {
                Icon(Icons.Default.MoreVert, "Открыть информацию", tint = if (track != null) Color.White else Muted)
            }
        }
        Spacer(Modifier.height(14.dp))
        Box(Modifier.fillMaxWidth().aspectRatio(1f).clip(RoundedCornerShape(24.dp)).background(Color(0xFF2B2050)), contentAlignment = Alignment.Center) {
            AsyncImage(track?.artworkUrl, null, Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
            if (track == null) Icon(Icons.Default.GraphicEq, "Нет выбранного трека", tint = Violet, modifier = Modifier.size(56.dp))
        }
        Row(Modifier.fillMaxWidth().padding(top = 18.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f).padding(end = 10.dp)) {
                Text(track?.title ?: "Выбери свой трек", color = Color.White, fontSize = 22.sp, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                Text(track?.artist ?: "Включи музыку из каталога", color = Muted, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 5.dp))
            }
            IconButton(onClick = onLike, enabled = track != null) {
                Icon(if (liked) Icons.Default.Favorite else Icons.Default.FavoriteBorder, if (liked) "Убрать из избранного" else "В избранное", tint = if (liked) Violet else Muted, modifier = Modifier.size(25.dp).popOn(liked))
            }
        }
        Spacer(Modifier.height(12.dp))
        SeekBar(positionMs = position, durationMs = duration, enabled = duration > 0f && track != null, onSeek = { controller?.seekTo(it.toLong()) }, modifier = Modifier.fillMaxWidth())
        Row(Modifier.fillMaxWidth().padding(top = 1.dp), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(formatTime(position.toLong()), color = Muted, fontSize = 11.sp)
            Text(formatTime(duration.toLong()), color = Muted, fontSize = 11.sp)
        }
        Spacer(Modifier.height(12.dp))
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly, verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = { shuffle = !shuffle; controller?.shuffleModeEnabled = shuffle }, modifier = Modifier.size(48.dp)) {
                Icon(Icons.Default.Shuffle, "Перемешать", tint = if (shuffle) Violet else Muted, modifier = Modifier.size(22.dp))
            }
            IconButton(onClick = previous, modifier = Modifier.size(52.dp)) { Icon(Icons.Default.SkipPrevious, "Предыдущий трек", tint = Color.White, modifier = Modifier.size(42.dp)) }
            FilledIconButton(onClick = { if (playing) pause() else resume() }, colors = IconButtonDefaults.filledIconButtonColors(containerColor = Color.White, contentColor = Ink), modifier = Modifier.size(72.dp)) {
                PlayPauseIcon(playing = playing, size = 35.dp, tint = Ink)
            }
            IconButton(onClick = next, modifier = Modifier.size(52.dp)) { Icon(Icons.Default.SkipNext, "Следующий трек", tint = Color.White, modifier = Modifier.size(42.dp)) }
            IconButton(onClick = {
                repeat = if (repeat == Player.REPEAT_MODE_OFF) Player.REPEAT_MODE_ALL else Player.REPEAT_MODE_OFF
                controller?.repeatMode = repeat
            }, modifier = Modifier.size(48.dp)) { Icon(Icons.Default.Repeat, "Повтор", tint = if (repeat == Player.REPEAT_MODE_ALL) Violet else Muted, modifier = Modifier.size(22.dp)) }
        }
        Spacer(Modifier.height(12.dp))
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            OutlinedButton(onClick = { showQueue = true }, enabled = playableQueue.isNotEmpty(), modifier = Modifier.weight(1f), colors = ButtonDefaults.outlinedButtonColors(contentColor = Color.White)) {
                Icon(Icons.Default.QueueMusic, null, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(6.dp))
                Text("Очередь")
            }
            OutlinedButton(onClick = { showTrackInfo = true }, enabled = track != null, modifier = Modifier.weight(1f), colors = ButtonDefaults.outlinedButtonColors(contentColor = Color.White)) {
                Icon(Icons.Default.Info, null, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(6.dp))
                Text("О треке")
            }
        }
        Spacer(Modifier.height(8.dp))
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
    var favorites by remember { mutableStateOf<List<Track>>(emptyList()) }
    var recentHistory by remember { mutableStateOf<List<Track>>(emptyList()) }
    var selected by remember { mutableStateOf<SonoraApi.Playlist?>(null) }
    var playlistTracks by remember { mutableStateOf<List<Track>>(emptyList()) }
    var title by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    val currentJamendoTrack = currentTrack?.takeIf { it.provider.equals("Jamendo", ignoreCase = true) }

    fun refreshLibrary() {
        scope.launch {
            busy = true
            try {
                val loaded = withContext(Dispatchers.IO) {
                    Triple(SonoraApi.getPlaylists(), SonoraApi.getProviderFavorites(), SonoraApi.getProviderHistory())
                }
                playlists = loaded.first
                favorites = loaded.second
                recentHistory = loaded.third
                error = ""
            } catch (e: Exception) { error = e.message ?: "Не удалось загрузить медиатеку" }
            finally { busy = false }
        }
    }

    LaunchedEffect(signedIn) {
        if (signedIn) refreshLibrary()
        else { playlists = emptyList(); favorites = emptyList(); recentHistory = emptyList(); selected = null; playlistTracks = emptyList() }
    }

    Column(Modifier.fillMaxSize().background(Ink).padding(20.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Медиатека", color = Color.White, fontSize = 28.sp, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
            if (signedIn) IconButton(onClick = { refreshLibrary() }, enabled = !busy) {
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
                if (currentJamendoTrack != null) {
                    OutlinedButton(
                        onClick = {
                            val target = currentJamendoTrack ?: return@OutlinedButton
                            scope.launch {
                                busy = true
                                try {
                                    withContext(Dispatchers.IO) { SonoraApi.addProviderFavorite(target) }
                                    favorites = withContext(Dispatchers.IO) { SonoraApi.getProviderFavorites() }
                                    error = "Добавлено в избранное"
                                } catch (e: Exception) { error = e.message ?: "Не удалось добавить в избранное" }
                                finally { busy = false }
                            }
                        },
                        enabled = !busy && favorites.none { it.providerTrackId == currentJamendoTrack.providerTrackId }
                    ) {
                        Icon(Icons.Default.Favorite, null, tint = Lime)
                        Spacer(Modifier.width(6.dp))
                        Text(if (favorites.any { it.providerTrackId == currentJamendoTrack.providerTrackId }) "Уже в избранном" else "Добавить текущий трек в избранное")
                    }
                }
                Text("Избранное", color = Color.White, fontSize = 18.sp, fontWeight = FontWeight.Bold)
                if (favorites.isEmpty() && !busy) Text("Пока нет избранных треков.", color = Muted, modifier = Modifier.padding(top = 8.dp))
                favorites.forEach { favorite ->
                    Row(
                        Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Panel).padding(8.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        AsyncImage(favorite.artworkUrl, null, Modifier.size(44.dp).clip(RoundedCornerShape(8.dp)), contentScale = ContentScale.Crop)
                        Column(Modifier.weight(1f).padding(horizontal = 10.dp)) {
                            Text(favorite.title, color = Color.White, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text(favorite.artist, color = Muted, fontSize = 12.sp, maxLines = 1)
                        }
                        IconButton(onClick = { if (favorite.playable) play(favorite) else error = "Трек временно недоступен для воспроизведения" }) {
                            Icon(Icons.Default.PlayCircleFilled, "Воспроизвести", tint = if (favorite.playable) Lime else Muted)
                        }
                        IconButton(onClick = {
                            scope.launch {
                                busy = true
                                try {
                                    withContext(Dispatchers.IO) { SonoraApi.removeProviderFavorite(favorite) }
                                    favorites = favorites.filterNot { it.providerTrackId == favorite.providerTrackId }
                                    error = ""
                                } catch (e: Exception) { error = e.message ?: "Не удалось удалить избранное" }
                                finally { busy = false }
                            }
                        }, enabled = !busy) { Icon(Icons.Default.Favorite, "Убрать из избранного", tint = Lime) }
                    }
                }
                Spacer(Modifier.height(14.dp))
                Text("Недавно слушали", color = Color.White, fontSize = 18.sp, fontWeight = FontWeight.Bold)
                if (recentHistory.isEmpty() && !busy) {
                    Text("История появится после прослушивания треков.", color = Muted, modifier = Modifier.padding(top = 8.dp))
                }
                recentHistory.take(8).forEach { recent ->
                    Row(
                        Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Panel).padding(8.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        AsyncImage(recent.artworkUrl, null, Modifier.size(42.dp).clip(RoundedCornerShape(8.dp)), contentScale = ContentScale.Crop)
                        Column(Modifier.weight(1f).padding(horizontal = 10.dp)) {
                            Text(recent.title, color = Color.White, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text(recent.artist, color = Muted, fontSize = 12.sp, maxLines = 1)
                        }
                        IconButton(onClick = { if (recent.playable) play(recent) else error = "Трек временно недоступен для воспроизведения" }) {
                            Icon(Icons.Default.PlayCircleFilled, "Воспроизвести", tint = if (recent.playable) Lime else Muted)
                        }
                    }
                }
                Spacer(Modifier.height(12.dp))
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
private fun ProfileScreen(step: String, authMode: String, setAuthMode: (String) -> Unit, email: String, setEmail: (String) -> Unit, username: String, setUsername: (String) -> Unit, displayName: String, setDisplayName: (String) -> Unit, code: String, setCode: (String) -> Unit, busy: Boolean, message: String, onRegister: () -> Unit, onLogin: () -> Unit, onVerify: () -> Unit, onLogout: () -> Unit) {
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
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(
                        selected = authMode == "login",
                        onClick = { setAuthMode("login") },
                        label = { Text("У меня уже есть аккаунт", maxLines = 1) },
                        modifier = Modifier.weight(1f),
                        colors = FilterChipDefaults.filterChipColors(selectedContainerColor = Color(0xFF33294E), selectedLabelColor = Color.White)
                    )
                    FilterChip(
                        selected = authMode == "register",
                        onClick = { setAuthMode("register") },
                        label = { Text("Создать аккаунт", maxLines = 1) },
                        modifier = Modifier.weight(1f),
                        colors = FilterChipDefaults.filterChipColors(selectedContainerColor = Color(0xFF33294E), selectedLabelColor = Color.White)
                    )
                }
                OutlinedTextField(email, setEmail, Modifier.fillMaxWidth(), label = { Text("Электронная почта") }, singleLine = true)
                if (authMode == "register") {
                    OutlinedTextField(username, setUsername, Modifier.fillMaxWidth(), label = { Text("Имя пользователя") }, singleLine = true)
                    OutlinedTextField(displayName, setDisplayName, Modifier.fillMaxWidth(), label = { Text("Отображаемое имя") }, singleLine = true)
                }
                Button(
                    onClick = { if (authMode == "login") onLogin() else onRegister() },
                    enabled = !busy && email.contains("@") && (authMode == "login" || (username.length >= 3 && displayName.isNotBlank())),
                    colors = ButtonDefaults.buttonColors(containerColor = Lime, contentColor = Ink),
                    modifier = Modifier.fillMaxWidth()
                ) { Text(if (authMode == "login") "Получить код и войти" else "Создать аккаунт") }
            }
        }
        if (busy) LinearProgressIndicator(Modifier.fillMaxWidth(), color = Lime)
        if (message.isNotBlank()) Text(message, color = Muted)
    }
}
