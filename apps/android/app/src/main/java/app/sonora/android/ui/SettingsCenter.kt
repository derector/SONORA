package app.sonora.android.ui

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccountCircle
import androidx.compose.material.icons.filled.BrightnessMedium
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.CloudOff
import androidx.compose.material.icons.filled.Computer
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.MailOutline
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.PlayCircleFilled
import androidx.compose.material.icons.filled.PrivacyTip
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.filled.Storefront
import androidx.compose.material.icons.filled.SystemUpdate
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material3.Badge
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.sonora.android.BuildConfig
import app.sonora.android.data.ProfileApi
import app.sonora.android.ota.ReleaseInfo
import coil.imageLoader
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private val Ink = Color(0xFF080910)
private val Muted = Color(0xFFC0BFD3)
private val Accent = Color(0xFFA78BFA)
private val Warning = Color(0xFFFF9A8D)

private const val WEB = "https://sonora-web-production-fb072d10.up.railway.app"

@Composable
fun SettingsCenter(
    update: ReleaseInfo?,
    checking: Boolean,
    lastCheckedAt: Long,
    notificationsAllowed: Boolean,
    signedIn: Boolean,
    email: String,
    onCheck: () -> Unit,
    onOpenUpdate: () -> Unit,
    onOpenProfile: () -> Unit,
    onSignOut: () -> Unit,
    onNonStopChanged: (Boolean) -> Unit,
    onQualityChanged: (Int) -> Unit
) {
    val context = LocalContext.current
    var page by androidx.compose.runtime.saveable.rememberSaveable { mutableStateOf(SettingsPage.Root) }
    BackHandler(enabled = page != SettingsPage.Root) { page = SettingsPage.Root }
    // Snapshot of the stored switches; every write goes to prefs and to the live effect.
    var nonStop by remember { mutableStateOf(SonoraPrefs.bool(context, SonoraPrefs.NON_STOP, true)) }
    var saver by remember { mutableStateOf(SonoraPrefs.bool(context, SonoraPrefs.DATA_SAVER, false)) }
    var cellularDownloads by remember {
        mutableStateOf(SonoraPrefs.bool(context, SonoraPrefs.DOWNLOAD_ON_CELLULAR, false))
    }
    var notifyUpdates by remember { mutableStateOf(SonoraPrefs.bool(context, SonoraPrefs.NOTIFY_UPDATES, true)) }
    var motionOn by remember { mutableStateOf(MotionSettings.userEnabled) }
    var cacheBytes by remember { mutableStateOf<Long?>(null) }
    var cacheMessage by remember { mutableStateOf("") }
    var cacheBusy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    fun refreshCacheSize(clearArtwork: Boolean = false) {
        if (cacheBusy) return
        cacheBusy = true
        cacheMessage = ""
        scope.launch {
            try {
                val bytes = withContext(Dispatchers.IO) {
                    if (clearArtwork) {
                        // Clear only the artwork loader. Offline tracks and the prepared OTA APK stay intact.
                        context.imageLoader.diskCache?.clear()
                        context.imageLoader.memoryCache?.clear()
                    }
                    SonoraPrefs.cacheSizeBytes(context)
                }
                cacheBytes = bytes
                if (clearArtwork) cacheMessage = "Кэш обложек очищен"
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                cacheMessage = if (clearArtwork) "Не удалось очистить кэш обложек" else "Не удалось проверить размер"
            } finally {
                cacheBusy = false
            }
        }
    }

    LaunchedEffect(page) { if (page == SettingsPage.Offline) refreshCacheSize() }

    Column(
        Modifier
            .fillMaxSize()
            .background(GlassBackdrop)
    ) {
        AnimatedContent(
            targetState = page,
            transitionSpec = {
                if (!MotionSettings.enabled) {
                    fadeIn(tween(0)) togetherWith fadeOut(tween(0))
                } else {
                    val forward = targetState != SettingsPage.Root
                    val enter = if (forward) {
                        slideInHorizontally(tween(220, easing = EaseOutBrand)) { it / 6 } + fadeIn(tween(220))
                    } else {
                        slideInHorizontally(tween(220, easing = EaseOutBrand)) { -it / 6 } + fadeIn(tween(220))
                    }
                    val exit = if (forward) {
                        slideOutHorizontally(tween(180)) { -it / 8 } + fadeOut(tween(180))
                    } else {
                        slideOutHorizontally(tween(180)) { it / 8 } + fadeOut(tween(180))
                    }
                    enter togetherWith exit
                }
            },
            label = "settings-page"
        ) { current ->
            Column(
                Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(bottom = 24.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                when (current) {
                    SettingsPage.Root -> RootPage(
                        signedIn = signedIn,
                        email = email,
                        nonStop = nonStop,
                        saver = saver,
                        notifyUpdates = notifyUpdates,
                        motionOn = motionOn,
                        update = update,
                        onOpen = { page = it },
                        onOpenProfile = onOpenProfile
                    )

                    else -> SubPage(
                        title = current.title,
                        onBack = { page = SettingsPage.Root }
                    ) {
                        when (current) {
                            SettingsPage.Playback -> {
                                ToggleRow(
                                    0, Icons.Default.PlayCircleFilled, "Повторять очередь",
                                    "После последнего трека воспроизведение начнётся с начала очереди.",
                                    nonStop
                                ) {
                                    nonStop = it
                                    SonoraPrefs.setBool(context, SonoraPrefs.NON_STOP, it)
                                    onNonStopChanged(it)
                                }
                                NoteRow("Качество аудио пока определяется доступным файлом. Выбор битрейта появится, когда сервер предоставит реальные варианты потока.")
                            }

                            SettingsPage.Offline -> {
                                ToggleRow(
                                    0, Icons.Default.CloudOff, "Экономить трафик",
                                    "Новые загрузки ждут нетарифицируемую сеть. Битрейт потоков пока не меняется.",
                                    saver
                                ) {
                                    saver = it
                                    SonoraPrefs.setBool(context, SonoraPrefs.DATA_SAVER, it)
                                    onQualityChanged(SonoraPrefs.qualityKbps(context, cellular = false))
                                }
                                ToggleRow(
                                    1, Icons.Default.Download, "Скачивать через мобильные сети",
                                    when {
                                        saver -> "При экономии трафика загрузки ждут нетарифицируемую сеть."
                                        cellularDownloads -> "Новые загрузки разрешены в любой сети."
                                        else -> "Новые загрузки ждут нетарифицируемую сеть."
                                    },
                                    cellularDownloads,
                                    enabled = !saver
                                ) {
                                    cellularDownloads = it
                                    SonoraPrefs.setBool(context, SonoraPrefs.DOWNLOAD_ON_CELLULAR, it)
                                }
                                ValueRow(
                                    2, Icons.Default.Computer, "Память приложения",
                                    when {
                                        cacheBusy -> "Считаем…"
                                        cacheBytes != null -> SonoraPrefs.formatBytes(checkNotNull(cacheBytes))
                                        else -> "Размер неизвестен"
                                    },
                                    "Обложки, офлайн-файлы и временные данные приложения."
                                )
                                Row(
                                    Modifier
                                        .fillMaxWidth()
                                        .padding(horizontal = 18.dp),
                                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                                ) {
                                    OutlinedButton(
                                        onClick = { refreshCacheSize(clearArtwork = true) },
                                        enabled = !cacheBusy
                                    ) { Text("Очистить обложки") }
                                    TextButton(
                                        onClick = { refreshCacheSize() },
                                        enabled = !cacheBusy
                                    ) { Text("Пересчитать") }
                                }
                                if (cacheMessage.isNotBlank()) {
                                    Text(
                                        cacheMessage,
                                        color = Muted,
                                        fontSize = 12.sp,
                                        modifier = Modifier.padding(horizontal = 20.dp)
                                    )
                                }
                            }

                            SettingsPage.Notifications -> {
                                ToggleRow(
                                    0, Icons.Default.Notifications, "Уведомления о новых версиях",
                                    if (notifyUpdates) "SONORA сообщает о новом релизе после фоновой проверки."
                                    else "Новые релизы по-прежнему видны в разделе обновлений.",
                                    notifyUpdates
                                ) {
                                    notifyUpdates = it
                                    SonoraPrefs.setBool(context, SonoraPrefs.NOTIFY_UPDATES, it)
                                }
                                ValueRow(
                                    1, Icons.Default.MailOutline, "Письма на почту",
                                    "Рассылки недоступны", "Коды входа по почте работают отдельно."
                                )
                                if (!notificationsAllowed) {
                                    NoteRow("Уведомления SONORA выключены в настройках Android.", tone = Warning)
                                    TextButton(onClick = {
                                        openExternal(context, Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                                            .putExtra(android.provider.Settings.EXTRA_APP_PACKAGE, context.packageName))
                                    }) { Text("Настройки уведомлений Android") }
                                }
                            }

                            SettingsPage.Privacy -> {
                                SectionTitle("Что видят другие пользователи")
                                PrivacyToggles(0)
                            }

                            SettingsPage.Appearance -> {
                                ToggleRow(
                                    0, Icons.Default.Visibility, "Анимации интерфейса",
                                    "Переходы вкладок, появление списков, мини-плеер. Системный отказ от анимаций " +
                                        "и режим reduced-motion работают вместе с этим переключателем.",
                                    motionOn
                                ) {
                                    motionOn = it
                                    MotionSettings.setEnabled(context, it)
                                }
                                ValueRow(
                                    1, Icons.Default.BrightnessMedium, "Тема", "Тёмная SONORA",
                                    "Оформление приложения"
                                )
                                ValueRow(
                                    2, Icons.Default.Info, "Язык", "Русский"
                                )
                            }

                            SettingsPage.Apps -> {
                                ValueRow(
                                    0, Icons.Default.Share, "Импорт из других сервисов", "Открыть в браузере",
                                    "Списки и любимые треки переносятся на странице импорта — там же предпросмотр " +
                                        "и совпадения.",
                                    onClick = { openUrl(context, "$WEB/import") }
                                )
                                ValueRow(
                                    1, Icons.Default.Computer, "Это устройство",
                                    "${Build.MANUFACTURER} ${Build.MODEL}".trim(),
                                    "Android ${Build.VERSION.RELEASE}"
                                )
                            }

                            SettingsPage.Info -> {
                                UpdateInfoRow(
                                    update = update,
                                    checking = checking,
                                    lastCheckedAt = lastCheckedAt,
                                    onCheck = onCheck,
                                    onOpenUpdate = onOpenUpdate
                                )
                                ValueRow(
                                    1, Icons.Default.Info, "Версия",
                                    "${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})",
                                    "SONORA для Android"
                                )
                                ValueRow(
                                    2, Icons.Default.PrivacyTip, "Политика конфиденциальности", "Открыть",
                                    onClick = { openUrl(context, "$WEB/legal") }
                                )
                                ValueRow(
                                    3, Icons.Default.Storefront, "Что нового", "Открыть список релизов",
                                    onClick = { openUrl(context, "https://github.com/derector/SONORA/releases") }
                                )
                            }
                            SettingsPage.Root -> Unit
                        }
                    }
                }
                if (current == SettingsPage.Root && signedIn) {
                    Spacer(Modifier.height(18.dp))
                    OutlinedButton(
                        onClick = onSignOut,
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 18.dp),
                        colors = ButtonDefaults.outlinedButtonColors(contentColor = Warning)
                    ) { Text("Выйти из аккаунта") }
                }
            }
        }
    }
}

private enum class SettingsPage(val title: String) {
    Root("Настройки"),
    Playback("Воспроизведение"),
    Offline("Оффлайн и трафик"),
    Notifications("Уведомления"),
    Privacy("Приватность"),
    Appearance("Внешний вид"),
    Apps("Приложения и устройства"),
    Info("Информация и поддержка")
}

@Composable
private fun RootPage(
    signedIn: Boolean,
    email: String,
    nonStop: Boolean,
    saver: Boolean,
    notifyUpdates: Boolean,
    motionOn: Boolean,
    update: ReleaseInfo?,
    onOpen: (SettingsPage) -> Unit,
    onOpenProfile: () -> Unit
) {
    SectionTitle("Настройки")
    ValueRow(
        0, Icons.Default.AccountCircle, "Аккаунт",
        if (signedIn) email.ifBlank { "Вход выполнен" } else "Не выполнен вход",
        "Имя, аватар и приватность профиля",
        onClick = onOpenProfile
    )
    ValueRow(
        1, Icons.Default.PlayCircleFilled, "Воспроизведение",
        if (nonStop) "Повтор очереди" else "Без повтора",
        "Порядок очереди и качество звука",
        onClick = { onOpen(SettingsPage.Playback) }
    )
    ValueRow(
        2, Icons.Default.Notifications, "Уведомления",
        if (notifyUpdates) "Об обновлениях: вкл" else "Об обновлениях: выкл",
        "Уведомления системы и новые версии",
        onClick = { onOpen(SettingsPage.Notifications) }
    )
    ValueRow(
        3, Icons.Default.CloudOff, "Оффлайн и трафик",
        if (saver) "Экономия трафика" else "Стандартный расход",
        "Загрузки, кэш, мобильные сети",
        onClick = { onOpen(SettingsPage.Offline) }
    )
    ValueRow(
        4, Icons.Default.Lock, "Приватность", "Кто видит профиль",
        "Видимость профиля и истории",
        onClick = { onOpen(SettingsPage.Privacy) }
    )
    ValueRow(
        5, Icons.Default.BrightnessMedium, "Внешний вид",
        if (motionOn) "Тёмная · анимации вкл" else "Тёмная · анимации выкл",
        onClick = { onOpen(SettingsPage.Appearance) }
    )
    ValueRow(
        6, Icons.Default.Computer, "Приложения и устройства", "Импорт из других сервисов",
        onClick = { onOpen(SettingsPage.Apps) }
    )
    ValueRow(
        7, Icons.Default.Info, "Информация и поддержка",
        "Версия ${BuildConfig.VERSION_NAME}" + if (update != null) " · есть обновление" else "",
        onClick = { onOpen(SettingsPage.Info) }
    )
}

@Composable
private fun SubPage(title: String, onBack: () -> Unit, content: @Composable () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(start = 8.dp, end = 18.dp, top = 18.dp, bottom = 4.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        TextButton(onClick = onBack) { Text("← Назад", color = Accent, fontSize = 14.sp) }
        Text(
            title,
            color = Color.White,
            fontSize = 24.sp,
            fontWeight = FontWeight.Bold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.padding(start = 4.dp)
        )
    }
    content()
}

@Composable
private fun SectionTitle(text: String) {
    Text(
        text.uppercase(),
        color = Muted,
        fontSize = 11.sp,
        fontWeight = FontWeight.Bold,
        letterSpacing = 1.6.sp,
        modifier = Modifier.padding(start = 22.dp, top = 22.dp, bottom = 2.dp, end = 22.dp)
    )
}

/** One settings line: icon, title, the value that is in force, and a chevron when tappable. */
@Composable
private fun ValueRow(
    index: Int,
    icon: ImageVector,
    title: String,
    value: String,
    subtitle: String? = null,
    onClick: (() -> Unit)? = null
) {
    val handler = onClick
    Card(index = index, clickable = handler) {
        IconBadge(icon)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(title, color = Color.White, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(
                value,
                color = Accent,
                fontSize = 13.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(top = 2.dp)
            )
            if (subtitle != null) {
                Text(
                    subtitle,
                    color = Muted,
                    fontSize = 12.sp,
                    lineHeight = 16.sp,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.padding(top = 2.dp)
                )
            }
        }
        if (handler != null) {
            Icon(Icons.Default.ChevronRight, null, tint = Muted, modifier = Modifier.size(20.dp))
        }
    }
}

@Composable
private fun ToggleRow(
    index: Int,
    icon: ImageVector,
    title: String,
    subtitle: String,
    checked: Boolean,
    enabled: Boolean = true,
    onChange: (Boolean) -> Unit
) {
    Card(
        index = index,
        clickable = null,
        interaction = Modifier.toggleable(value = checked, enabled = enabled, role = Role.Switch, onValueChange = onChange)
    ) {
        IconBadge(icon)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(title, color = Color.White, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(
                subtitle,
                color = Muted,
                fontSize = 12.sp,
                lineHeight = 16.sp,
                maxLines = 3,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(top = 3.dp)
            )
        }
        Spacer(Modifier.width(8.dp))
        Switch(checked = checked, enabled = enabled, onCheckedChange = null)
    }
}

@Composable
private fun NoteRow(text: String, tone: Color = Muted) {
    Text(
        text,
        color = tone,
        fontSize = 12.sp,
        lineHeight = 17.sp,
        modifier = Modifier.padding(horizontal = 22.dp, vertical = 6.dp)
    )
}

@Composable
private fun IconBadge(icon: ImageVector) {
    Box(
        Modifier
            .size(34.dp)
            .sonoraGlass(CircleShape, GlassTone.Accent),
        contentAlignment = Alignment.Center
    ) {
        Icon(icon, null, tint = Color(0xFFF0E9FF), modifier = Modifier.size(18.dp))
    }
}

/**
 * Card wrapper with the shared motion contract: rows stagger in, cards settle on press,
 * and both are skipped when the system or the user turned animation off.
 */
@Composable
private fun Card(
    index: Int,
    clickable: (() -> Unit)?,
    interaction: Modifier = Modifier,
    content: @Composable RowScope.() -> Unit
) {
    val shape = RoundedCornerShape(16.dp)
    val base = Modifier
        .fillMaxWidth()
        .padding(horizontal = 18.dp)
        .staggerEnter(index)
        .sonoraGlass(shape)
    val wrapped = if (clickable != null) base.then(Modifier.pressScale(onClick = clickable)) else base
    Box(wrapped.then(interaction).padding(14.dp)) {
        Row(
            Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(0.dp)
        ) { content() }
    }
}

@Composable
private fun UpdateInfoRow(
    update: ReleaseInfo?,
    checking: Boolean,
    lastCheckedAt: Long,
    onCheck: () -> Unit,
    onOpenUpdate: () -> Unit
) {
    Card(index = 0, clickable = if (update != null) onOpenUpdate else null) {
        IconBadge(Icons.Default.SystemUpdate)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(
                if (update != null) "Доступно обновление ${update.versionLabel}" else "Обновления SONORA",
                color = Color.White,
                fontSize = 15.sp,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
            Text(
                when {
                    checking -> "Проверяем…"
                    update != null -> "${update.apkSizeLabel} · установка внутри приложения"
                    lastCheckedAt == 0L -> "Проверка ещё не выполнялась"
                    else -> "Последняя проверка: " + java.text.SimpleDateFormat(
                        "dd.MM HH:mm", java.util.Locale.getDefault()
                    ).format(java.util.Date(lastCheckedAt))
                },
                color = Muted,
                fontSize = 12.sp,
                modifier = Modifier.padding(top = 2.dp)
            )
        }
        when {
            checking -> CircularProgressIndicator(Modifier.size(18.dp), color = Accent, strokeWidth = 2.dp)
            update != null -> Badge(containerColor = Accent) { Text("NEW", color = Ink, fontSize = 9.sp, fontWeight = FontWeight.Black) }
        }
    }
    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 18.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        if (update != null) {
            Button(
                onClick = onOpenUpdate,
                colors = ButtonDefaults.buttonColors(containerColor = Accent, contentColor = Ink),
                modifier = Modifier.weight(1f)
            ) { Text("Обновить") }
        }
        OutlinedButton(onClick = onCheck, enabled = !checking, modifier = Modifier.weight(1f)) {
            Text(if (update == null) "Проверить" else "Проверить ещё раз")
        }
    }
}

/** Account privacy, shown on the profile and in settings using the same server contract. */
@Composable
fun PrivacyToggles(startIndex: Int = 0) {
    val scope = rememberCoroutineScope()
    var privacy by remember { mutableStateOf<ProfileApi.Privacy?>(null) }
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf("") }

    fun load() {
        if (busy) return
        busy = true
        message = ""
        scope.launch {
            try {
                privacy = withContext(Dispatchers.IO) { ProfileApi.getPrivacy() }
                if (privacy == null) message = "Не удалось получить настройки профиля."
            } finally {
                busy = false
            }
        }
    }

    fun save(next: ProfileApi.Privacy) {
        if (busy) return
        busy = true
        message = ""
        scope.launch {
            try {
                val saved = withContext(Dispatchers.IO) { ProfileApi.savePrivacy(next) }
                if (saved == null) message = "Сохранение не подтверждено. Проверьте подключение и обновите настройки."
                else privacy = saved
            } finally {
                busy = false
            }
        }
    }

    val signedIn = app.sonora.android.data.SonoraApi.accessToken() != null
    LaunchedEffect(signedIn) { if (signedIn) load() }
    if (!signedIn) {
        NoteRow("Войдите в аккаунт, чтобы изменить приватность публичного профиля.")
        return
    }

    val current = privacy
    if (current == null && busy) NoteRow("Загружаем настройки…")
    if (current != null) {
        val canSave = !busy && message.isBlank()
        ToggleRow(
            startIndex, Icons.Default.AccountCircle, "Публичный профиль",
            "Позволить другим пользователям открывать ваш профиль.",
            current.profilePublic, enabled = canSave
        ) { save(current.copy(profilePublic = it)) }
        ToggleRow(
            startIndex + 1, Icons.Default.Visibility, "История прослушивания",
            "Показывать прослушивания в публичном профиле.",
            current.history, enabled = canSave
        ) { save(current.copy(history = it)) }
    }
    if (message.isNotBlank()) {
        NoteRow(message, tone = Warning)
        TextButton(
            onClick = ::load,
            enabled = !busy,
            modifier = Modifier.padding(horizontal = 18.dp)
        ) { Text("Обновить настройки") }
    }
}

private fun openExternal(context: Context, intent: Intent) {
    try {
        context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    } catch (_: android.content.ActivityNotFoundException) {
        Toast.makeText(context, "На устройстве нет приложения для этого действия.", Toast.LENGTH_LONG).show()
    } catch (_: SecurityException) {
        Toast.makeText(context, "Не удалось открыть этот раздел.", Toast.LENGTH_LONG).show()
    }
}

private fun openUrl(context: Context, raw: String) =
    openExternal(context, Intent(Intent.ACTION_VIEW, Uri.parse(raw)))
