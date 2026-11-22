package app.sonora.android.ui

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.PersonAdd
import androidx.compose.material.icons.filled.PhotoCamera
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.InsertChart
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.sonora.android.data.ProfileApi
import app.sonora.android.data.SonoraApi
import app.sonora.android.data.Track
import coil.compose.AsyncImage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.io.File

private val Ink = Color(0xFF080910)
private val Panel = Color(0xFF141522)
private val Muted = Color(0xFF9698AC)
private val Accent = Color(0xFFA78BFA)
private val AccentDeep = Color(0xFF2A1F4A)

/**
 * Profile v1 — the account surface the web already has, in the app's own layout language.
 *
 * The header is a violet brand wash (not the green of the previous build) that darkens as
 * the screen scrolls, exactly like the reference: the veil is driven by the real scroll
 * offset, so it responds on any device instead of being a static gradient.
 */
@Composable
fun ProfileCenter(
    email: String,
    onLogout: () -> Unit,
    onOpenLibrary: () -> Unit,
    play: (Track) -> Unit
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val motion = rememberMotionEnabled()
    val scroll = rememberScrollState()
    val veil by animateFloatAsState(
        targetValue = (scroll.value / 320f).coerceIn(0f, 1f),
        animationSpec = if (motion) tween(120) else snap(),
        label = "header-veil"
    )

    var displayName by remember { mutableStateOf(SonoraPrefs.string(context, SonoraPrefs.DISPLAY_NAME)) }
    var username by remember { mutableStateOf(SonoraPrefs.string(context, SonoraPrefs.USERNAME)) }
    var avatarPath by remember { mutableStateOf(SonoraPrefs.string(context, SonoraPrefs.AVATAR_PATH)) }
    var avatarRemote by remember { mutableStateOf<String?>(null) }
    var avatarTick by remember { mutableStateOf(0) }
    var registeredAt by remember { mutableStateOf("") }
    var status by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var showStats by remember { mutableStateOf(false) }
    var editOpen by remember { mutableStateOf(false) }
    var privacyOpen by remember { mutableStateOf(false) }
    var favorites by remember { mutableStateOf<List<Track>>(emptyList()) }
    var history by remember { mutableStateOf<List<Track>>(emptyList()) }
    var playlists by remember { mutableStateOf<List<SonoraApi.Playlist>>(emptyList()) }

    val name = displayName.ifBlank { email.substringBefore('@').ifBlank { "Гость SONORA" } }
    val handle = username.ifBlank { email.substringBefore('@') }

    // Avatar: pick → downscale locally → try the upload route. The local copy is always
    // kept, so the picture is visible offline and while /profile/avatar is still landing.
    val pickAvatar = rememberLauncherForActivityResult(
        ActivityResultContracts.PickVisualMedia()
    ) { uri: Uri? ->
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch(Dispatchers.IO) {
            val saved = writeAvatar(context, uri)
            if (saved == null) {
                status = "Не удалось прочитать изображение"
                return@launch
            }
            SonoraPrefs.setString(context, SonoraPrefs.AVATAR_PATH, saved.absolutePath)
            avatarPath = saved.absolutePath
            avatarTick += 1
            val uploaded = runCatching { ProfileApi.uploadAvatar(saved.readBytes()) }.getOrNull()
            if (uploaded != null) avatarRemote = uploaded
        }
    }

    LaunchedEffect(Unit) {
        busy = true
        val loaded = withContext(Dispatchers.IO) {
            AvatarBundle(
                profile = runCatching { ProfileApi.fetch() }.getOrNull(),
                favorites = runCatching { SonoraApi.getProviderFavorites() }.getOrDefault(emptyList()),
                history = runCatching { SonoraApi.getProviderHistory() }.getOrDefault(emptyList()),
                playlists = runCatching { SonoraApi.getPlaylists() }.getOrDefault(emptyList())
            )
        }
        loaded.profile?.let { remote ->
            if (displayName.isBlank() && !remote.displayName.isNullOrBlank()) {
                displayName = remote.displayName.orEmpty()
                SonoraPrefs.setString(context, SonoraPrefs.DISPLAY_NAME, displayName)
            }
            if (username.isBlank() && !remote.username.isNullOrBlank()) {
                username = remote.username.orEmpty()
                SonoraPrefs.setString(context, SonoraPrefs.USERNAME, username)
            }
            if (avatarRemote == null) avatarRemote = remote.avatarUrl
            registeredAt = remote.createdAt.orEmpty()
        }
        favorites = loaded.favorites
        history = loaded.history
        playlists = loaded.playlists
        busy = false
    }

    val topArtists = remember(favorites, history) {
        (favorites + history)
            .asSequence()
            .map { it.artist.trim() }
            .filter { it.isNotEmpty() }
            .groupingBy { it }
            .eachCount()
            .entries
            .sortedByDescending { it.value }
            .take(3)
    }

    Box(Modifier.fillMaxSize().background(Ink)) {
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(scroll)
        ) {
            // ── Brand header: violet wash, darkened by the real scroll offset ─────────
            Box(
                Modifier
                    .fillMaxWidth()
                    .background(Brush.verticalGradient(listOf(AccentDeep, Color(0xFF151228), Ink)))
            ) {
                Box(
                    Modifier
                        .matchParentSize()
                        .background(Color(0xFF0A0A0F).copy(alpha = veil * 0.85f))
                )
                Column(
                    Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 22.dp, vertical = 28.dp),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Box(
                        Modifier
                            .size(112.dp)
                            .clip(CircleShape)
                            .background(Brush.linearGradient(listOf(Accent, Color(0xFF60A5FA), Color(0xFF2DD4BF))))
                            .border(2.dp, Color.White.copy(alpha = 0.14f), CircleShape)
                            .pressScale(onClick = {
                                pickAvatar.launch(
                                    PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)
                                )
                            }),
                        contentAlignment = Alignment.Center
                    ) {
                        val model: Any? = when {
                            avatarPath.isNotBlank() -> File(avatarPath)
                            !avatarRemote.isNullOrBlank() -> avatarRemote
                            else -> null
                        }
                        if (model != null) {
                            AsyncImage(
                                model = model,
                                contentDescription = "Аватар",
                                modifier = Modifier.fillMaxSize(),
                                contentScale = ContentScale.Crop
                            )
                        } else {
                            Text(
                                name.take(1).uppercase(),
                                color = Ink,
                                fontSize = 40.sp,
                                fontWeight = FontWeight.Black
                            )
                        }
                        Box(
                            Modifier
                                .align(Alignment.BottomEnd)
                                .size(34.dp)
                                .clip(CircleShape)
                                .background(Color(0xF01B1C2C)),
                            contentAlignment = Alignment.Center
                        ) {
                            Icon(Icons.Default.PhotoCamera, "Сменить аватар", tint = Color.White, modifier = Modifier.size(17.dp))
                        }
                    }
                    Text(
                        name,
                        color = Color.White,
                        fontSize = 26.sp,
                        fontWeight = FontWeight.Bold,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.padding(top = 14.dp)
                    )
                    Text(
                        "@$handle",
                        color = Color(0xFFD8CCFF),
                        fontSize = 14.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                    if (email.isNotBlank()) {
                        Text(email, color = Muted, fontSize = 12.sp, modifier = Modifier.padding(top = 2.dp))
                    }
                    if (registeredAt.isNotBlank()) {
                        Text("В SONORA с $registeredAt", color = Muted, fontSize = 12.sp, modifier = Modifier.padding(top = 2.dp))
                    }
                    Row(
                        Modifier.fillMaxWidth().padding(top = 16.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        OutlinedButton(onClick = { editOpen = true }, modifier = Modifier.weight(1f)) {
                            Icon(Icons.Default.Edit, null, modifier = Modifier.size(16.dp))
                            Spacer(Modifier.width(6.dp))
                            Text("Изменить", maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                        OutlinedButton(onClick = { privacyOpen = true }, modifier = Modifier.weight(1f)) {
                            Icon(Icons.Default.Lock, null, modifier = Modifier.size(16.dp))
                            Spacer(Modifier.width(6.dp))
                            Text("Приватность", maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                    }
                    OutlinedButton(
                        onClick = { showStats = !showStats },
                        modifier = Modifier.fillMaxWidth().padding(top = 8.dp)
                    ) {
                        Icon(Icons.Default.InsertChart, null, modifier = Modifier.size(16.dp))
                        Spacer(Modifier.width(6.dp))
                        Text(if (showStats) "Скрыть статистику" else "Статистика")
                    }
                }
            }

            AnimatedVisibility(
                visible = showStats,
                enter = if (motion) fadeIn(tween(220)) + expandVertically(tween(240, easing = EaseOutBrand)) else fadeIn(),
                exit = if (motion) fadeOut(tween(160)) + shrinkVertically(tween(200)) else fadeOut()
            ) {
                StatsCard(
                    favorites = favorites.size,
                    history = history.size,
                    playlists = playlists.size,
                    topArtists = topArtists.map { it.key to it.value },
                    index = 0
                )
            }

            SectionLabel("Плейлисты", 22.dp)
            if (playlists.isEmpty() && !busy) {
                EmptyHint("Плейлистов пока нет. Создай первый в Медиатеке — они появятся здесь и на сайте.")
            } else {
                playlists.take(8).forEachIndexed { index, playlist ->
                    ClickRow(
                        index = index + 1,
                        title = playlist.title,
                        subtitle = if (playlist.trackCount > 0) "${playlist.trackCount} треков" else "Открыть в Медиатеке",
                        leading = null,
                        trailing = { Icon(Icons.Default.PlayArrow, null, tint = Accent, modifier = Modifier.size(18.dp)) },
                        onClick = onOpenLibrary
                    )
                }
            }

            SectionLabel("Недавно прослушано", 22.dp)
            if (history.isEmpty() && !busy) {
                EmptyHint("История появится после первого прослушивания.")
            } else {
                history.take(5).forEachIndexed { index, track ->
                    ClickRow(
                        index = index + 1,
                        title = track.title,
                        subtitle = track.artist,
                        leading = {
                            AsyncImage(
                                model = track.artworkUrl,
                                contentDescription = null,
                                modifier = Modifier.size(42.dp).clip(RoundedCornerShape(9.dp)),
                                contentScale = ContentScale.Crop
                            )
                        },
                        trailing = null,
                        onClick = { play(track) }
                    )
                }
            }

            SectionLabel("Исполнители", 22.dp)
            EmptyHint("Подписки на исполнителей появятся здесь, когда эта функция станет доступна.")

            if (busy) {
                Box(Modifier.fillMaxWidth().padding(18.dp), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(Modifier.size(22.dp), color = Accent, strokeWidth = 2.dp)
                }
            }

            Text(
                status,
                color = Muted,
                fontSize = 12.sp,
                maxLines = 3,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier
                    .alpha(if (status.isBlank()) 0f else 1f)
                    .padding(start = 22.dp, end = 22.dp, top = 6.dp)
            )

            Spacer(Modifier.height(14.dp))
            OutlinedButton(
                onClick = onLogout,
                modifier = Modifier.fillMaxWidth().padding(horizontal = 18.dp),
                colors = ButtonDefaults.outlinedButtonColors(contentColor = Color(0xFFFF9A8D))
            ) { Text("Выйти из аккаунта") }
            Spacer(Modifier.height(28.dp))
        }

        if (privacyOpen) {
            PrivacySheet(onDismiss = { privacyOpen = false })
        }
    }

    if (editOpen) {
        EditProfileDialog(
            initialName = displayName,
            initialUsername = username,
            onDismiss = { editOpen = false },
            onSave = { newName, newHandle ->
                editOpen = false
                scope.launch(Dispatchers.IO) {
                    val synced = runCatching { ProfileApi.update(newName, newHandle) }.getOrDefault(false)
                    withContext(Dispatchers.Main) {
                        displayName = newName
                        username = newHandle
                        SonoraPrefs.setString(context, SonoraPrefs.DISPLAY_NAME, newName)
                        SonoraPrefs.setString(context, SonoraPrefs.USERNAME, newHandle)
                        status = if (synced) "Профиль обновлён"
                        else "Сохранено на устройстве — серверная синхронизация профиля появится со Справочным API"
                        Toast.makeText(context, if (synced) "Профиль обновлён" else "Сохранено на устройстве", Toast.LENGTH_SHORT).show()
                    }
                }
            }
        )
    }
}

private data class AvatarBundle(
    val profile: ProfileApi.Profile?,
    val favorites: List<Track>,
    val history: List<Track>,
    val playlists: List<SonoraApi.Playlist>
)

/**
 * Decodes the picked picture at a sane size and stores it as JPEG in the app's private
 * files. The profile avatar is a 112dp circle, so 512px is more than enough for any density
 * and keeps the upload small on mobile networks.
 */
private fun writeAvatar(context: Context, uri: Uri): File? = runCatching {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
    val largest = maxOf(bounds.outWidth, bounds.outHeight).takeIf { it > 0 } ?: 1024
    val options = BitmapFactory.Options().apply {
        inSampleSize = generateSequence(1) { it * 2 }.first { largest / it <= 512 }
    }
    val bitmap = context.contentResolver.openInputStream(uri)?.use {
        BitmapFactory.decodeStream(it, null, options)
    } ?: return null
    val out = ByteArrayOutputStream()
    bitmap.compress(Bitmap.CompressFormat.JPEG, 84, out)
    val file = File(context.filesDir, "profile_avatar.jpg")
    file.writeBytes(out.toByteArray())
    file
}.getOrNull()

@Composable
private fun SectionLabel(text: String, topPadding: androidx.compose.ui.unit.Dp) {
    Text(
        text,
        color = Color.White,
        fontSize = 19.sp,
        fontWeight = FontWeight.Bold,
        modifier = Modifier.padding(start = 22.dp, end = 22.dp, top = 24.dp, bottom = 8.dp)
    )
}

@Composable
private fun EmptyHint(text: String) {
    Text(
        text,
        color = Muted,
        fontSize = 13.sp,
        lineHeight = 18.sp,
        modifier = Modifier.padding(horizontal = 22.dp, vertical = 4.dp)
    )
}

@Composable
private fun ClickRow(
    index: Int,
    title: String,
    subtitle: String,
    leading: (@Composable () -> Unit)?,
    trailing: (@Composable () -> Unit)?,
    onClick: () -> Unit
) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 18.dp, vertical = 4.dp)
            .staggerEnter(index)
            .clip(RoundedCornerShape(14.dp))
            .background(Panel)
            .pressScale(onClick = onClick)
            .padding(12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        if (leading != null) {
            leading()
            Spacer(Modifier.width(11.dp))
        }
        Column(Modifier.weight(1f)) {
            Text(title, color = Color.White, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(subtitle, color = Muted, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 2.dp))
        }
        if (trailing != null) Spacer(Modifier.width(8.dp)).also { trailing() }
    }
}

@Composable
private fun StatsCard(
    favorites: Int,
    history: Int,
    playlists: Int,
    topArtists: List<Pair<String, Int>>,
    index: Int
) {
    Column(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 18.dp)
            .staggerEnter(index)
            .sonoraGlass(RoundedCornerShape(18.dp))
            .padding(16.dp)
    ) {
        Text("Статистика прослушивания", color = Color.White, fontSize = 17.sp, fontWeight = FontWeight.Bold)
        Row(
            Modifier
                .fillMaxWidth()
                .padding(top = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            Stat("Любимых", favorites)
            Stat("Прослушано", history)
            Stat("Плейлистов", playlists)
        }
        Spacer(Modifier.height(14.dp))
        Text("Твои топ-артисты", color = Color.White, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
        if (topArtists.isEmpty()) {
            Text("Пока считаем: нужна история прослушивания.", color = Muted, fontSize = 12.sp, modifier = Modifier.padding(top = 4.dp))
        } else {
            topArtists.forEach { (artist, count) ->
                Row(Modifier.fillMaxWidth().padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Default.PersonAdd, null, tint = Accent, modifier = Modifier.size(16.dp))
                    Spacer(Modifier.width(8.dp))
                    Text(artist, color = Color.White, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                    Text("$count", color = Muted, fontSize = 12.sp)
                }
            }
        }
        Text(
            "Счётчики взяты из твоей синхронизированной коллекции.",
            color = Muted,
            fontSize = 11.sp,
            modifier = Modifier.padding(top = 12.dp)
        )
    }
}

@Composable
private fun RowScope.Stat(label: String, value: Int) {
    Column(
        Modifier
            .weight(1f)
            .clip(RoundedCornerShape(14.dp))
            .background(Color(0xFF1D1F2E))
            .padding(horizontal = 10.dp, vertical = 12.dp),
        horizontalAlignment = Alignment.Start
    ) {
        Text("$value", color = Accent, fontSize = 22.sp, fontWeight = FontWeight.Bold)
        Text(label, color = Muted, fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/**
 * "Что видят другие пользователи" — the same three switches the settings page uses, so the
 * contract cannot drift between the two entry points.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun PrivacySheet(onDismiss: () -> Unit) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = false)
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = Color(0xFF12131F),
        scrimColor = Color(0xB3000000)
    ) {
        Column(Modifier.padding(horizontal = 20.dp, vertical = 8.dp)) {
            Text(
                "Что видят другие пользователи",
                color = Color.White,
                fontSize = 20.sp,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.padding(bottom = 4.dp)
            )
            Text(
                "Твой профиль открыт по ссылке sonora://share — вот что в нём показывать.",
                color = Muted,
                fontSize = 12.sp,
                lineHeight = 17.sp,
                modifier = Modifier.padding(bottom = 10.dp)
            )
            PrivacyToggles(0)
            Spacer(Modifier.height(10.dp))
            Button(
                onClick = onDismiss,
                modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.buttonColors(containerColor = Accent, contentColor = Ink)
            ) { Text("Все настройки конфиденциальности") }
            TextButton(onClick = onDismiss, modifier = Modifier.fillMaxWidth()) {
                Text("Закрыть", color = Muted)
            }
            Spacer(Modifier.height(20.dp))
        }
    }
}

@Composable
private fun EditProfileDialog(
    initialName: String,
    initialUsername: String,
    onDismiss: () -> Unit,
    onSave: (String, String) -> Unit
) {
    var name by remember { mutableStateOf(initialName) }
    var handle by remember { mutableStateOf(initialUsername) }
    androidx.compose.material3.AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = Panel,
        title = { Text("Профиль", color = Color.White) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it.take(40) },
                    label = { Text("Имя") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                    colors = androidx.compose.material3.OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = Accent,
                        unfocusedBorderColor = Color(0xFF2A2C3D),
                        focusedTextColor = Color.White,
                        unfocusedTextColor = Color.White
                    )
                )
                OutlinedTextField(
                    value = handle,
                    onValueChange = { handle = it.replace(" ", "").take(24) },
                    label = { Text("Имя пользователя") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                    colors = androidx.compose.material3.OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = Accent,
                        unfocusedBorderColor = Color(0xFF2A2C3D),
                        focusedTextColor = Color.White,
                        unfocusedTextColor = Color.White
                    )
                )
                Text(
                    "Имя пользователя — ссылка на профиль. Пустые значения не сохраняются.",
                    color = Muted,
                    fontSize = 11.sp,
                    lineHeight = 15.sp
                )
            }
        },
        confirmButton = {
            TextButton(onClick = { if (name.isNotBlank() || handle.isNotBlank()) onSave(name, handle) }) {
                Text("Сохранить", color = Accent)
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Отмена", color = Muted) }
        }
    )
}
