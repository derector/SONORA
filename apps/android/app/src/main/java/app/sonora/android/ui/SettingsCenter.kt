package app.sonora.android.ui

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
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
import androidx.compose.foundation.layout.PaddingValues
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
import androidx.compose.material.icons.filled.Gavel
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.MailOutline
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.PlayCircleFilled
import androidx.compose.material.icons.filled.PrivacyTip
import androidx.compose.material.icons.filled.Refresh
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
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.sonora.android.BuildConfig
import app.sonora.android.data.ProfileApi
import app.sonora.android.ota.ReleaseInfo
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private val Ink = Color(0xFF080910)
private val Panel = Color(0xFF141522)
private val PanelAlt = Color(0xFF1B1C2C)
private val Muted = Color(0xFF9698AC)
private val Accent = Color(0xFFA78BFA)
private val Warning = Color(0xFFFF9A8D)

private const val WEB = "https://sonora-web-production-fb072d10.up.railway.app"

/**
 * Settings as a list of categories, Spotify-style: every row shows the value that is
 * currently in force, and every switch changes behaviour rather than only its own state.
 *
 * What is actually wired (all of it read back where the behaviour lives):
 *  - non-stop playback → MainActivity keeps feeding the queue when it runs out;
 *  - bitrate per network class → SonoraApi.qualityKbps, sent as X-Sonora-Quality on every
 *    request (the server honours it as soon as API-lane lands the parameter);
 *  - data saver → same 96 kbit ceiling plus smaller artwork loading in the rails;
 *  - downloads over cellular → the network constraint of the download worker;
 *  - update notifications → whether SONORA alerts the user about a new release;
 *  - interface animations → MotionSettings, which gates every transition in the app.
 */
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
    var page by androidx.compose.runtime.saveable.rememberSaveable { mutableStateOf("root") }
    // Snapshot of the stored switches; every write goes to prefs and to the live effect.
    var nonStop by remember { mutableStateOf(SonoraPrefs.bool(context, SonoraPrefs.NON_STOP, true)) }
    var saver by remember { mutableStateOf(SonoraPrefs.bool(context, SonoraPrefs.DATA_SAVER, false)) }
    var cellularDownloads by remember {
        mutableStateOf(SonoraPrefs.bool(context, SonoraPrefs.DOWNLOAD_ON_CELLULAR, false))
    }
    var notifyUpdates by remember { mutableStateOf(SonoraPrefs.bool(context, SonoraPrefs.NOTIFY_UPDATES, true)) }
    var notifyEmails by remember { mutableStateOf(SonoraPrefs.bool(context, SonoraPrefs.NOTIFY_EMAILS, true)) }
    var motionOn by remember { mutableStateOf(MotionSettings.userEnabled) }
    var qualityWifi by remember { mutableStateOf(SonoraPrefs.int(context, SonoraPrefs.QUALITY_WIFI, 160)) }
    var qualityCellular by remember { mutableStateOf(SonoraPrefs.int(context, SonoraPrefs.QUALITY_CELLULAR, 96)) }
    var cacheBytes by remember { mutableStateOf(0L) }
    var cacheMessage by remember { mutableStateOf("") }
    val scope = rememberCoroutineScope()

    fun refreshCacheSize() {
        scope.launch {
            cacheBytes = withContext(Dispatchers.IO) { SonoraPrefs.cacheSizeBytes(context) }
        }
    }

    LaunchedEffect(page) { if (page == "offline") refreshCacheSize() }

    Column(
        Modifier
            .fillMaxSize()
            .background(Ink)
            .verticalScroll(rememberScrollState())
            .padding(bottom = 24.dp)
    ) {
        AnimatedContent(
            targetState = page,
            transitionSpec = {
                if (!MotionSettings.enabled) {
                    fadeIn(tween(120)) togetherWith fadeOut(tween(100))
                } else {
                    val forward = page != "root"
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
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                when (current) {
                    "root" -> RootPage(
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
                        title = pageTitles.getValue(current),
                        onBack = { page = "root" }
                    ) {
                        when (current) {
                            "playback" -> {
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

                            "offline" -> {
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
                                    if (cellularDownloads) "Загрузки разрешены в любой сети."
                                    else "Новые загрузки ждут нетарифицируемую сеть.",
                                    cellularDownloads
                                ) {
                                    cellularDownloads = it
                                    SonoraPrefs.setBool(context, SonoraPrefs.DOWNLOAD_ON_CELLULAR, it)
                                }
                                ValueRow(
                                    2, Icons.Default.Computer, "Кэш на устройстве",
                                    if (cacheBytes > 0) SonoraPrefs.formatBytes(cacheBytes) else "Считаем…",
                                    "Обложки, база офлайн-треков и временные файлы приложения."
                                )
                                Row(
                                    Modifier
                                        .fillMaxWidth()
                                        .padding(horizontal = 18.dp),
                                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                                ) {
                                    OutlinedButton(onClick = {
                                        scope.launch(Dispatchers.IO) {
                                            // Only Coil's artwork cache is removed: the prepared
                                            // update APK lives in the same folder and the installer
                                            // flow must survive a cache clear.
                                            runCatching {
                                                val images = java.io.File(context.cacheDir, "image_cache")
                                                if (images.exists()) images.deleteRecursively()
                                            }
                                            cacheBytes = SonoraPrefs.cacheSizeBytes(context)
                                            cacheMessage = "Кэш обложек очищен"
                                        }
                                    }) { Text("Очистить обложки") }
                                    TextButton(onClick = ::refreshCacheSize) { Text("Обновить") }
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

                            "notifications" -> {
                                ToggleRow(
                                    0, Icons.Default.Notifications, "Уведомления о новых версиях",
                                    if (notifyUpdates) "SONORA сообщает о новом релизе после фоновой проверки."
                                    else "Новые релизы по-прежнему видны в разделе обновлений.",
                                    notifyUpdates
                                ) {
                                    notifyUpdates = it
                                    SonoraPrefs.setBool(context, SonoraPrefs.NOTIFY_UPDATES, it)
                                }
                                ToggleRow(
                                    1, Icons.Default.MailOutline, "Письма на почту",
                                    if (email.isBlank()) "Сначала укажи почту в профиле."
                                    else "Сводки о плейлистах и новых релизах на $email.",
                                    notifyEmails
                                ) {
                                    notifyEmails = it
                                    SonoraPrefs.setBool(context, SonoraPrefs.NOTIFY_EMAILS, it)
                                    scope.launch(Dispatchers.IO) { ProfileApi.pushNotifications(it) }
                                }
                                if (!notificationsAllowed) {
                                    NoteRow("Уведомления SONORA выключены в настройках Android.", tone = Warning)
                                    TextButton(onClick = {
                                        context.startActivity(Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                                            .putExtra(android.provider.Settings.EXTRA_APP_PACKAGE, context.packageName))
                                    }) { Text("Настройки уведомлений Android") }
                                }
                            }

                            "privacy" -> {
                                SectionTitle("Что видят другие пользователи")
                                PrivacyToggles(0)
                                NoteRow(
                                    "Настройки применяются к публичной части профиля: подписчикам, плейлистам " +
                                        "и истории прослушивания."
                                )
                            }

                            "appearance" -> {
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
                                    "Светлая тема идёт вместе с дизайн-системой на сайте."
                                )
                                ValueRow(
                                    2, Icons.Default.Info, "Язык", "Русский",
                                    "Английский подключим вместе с веб-версией."
                                )
                            }

                            "apps" -> {
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
                                NoteRow(
                                    "Подключённых сервисов пока нет. Spotify и YouTube появятся, как только " +
                                        "разрешённые OAuth-ключи будут в приложении."
                                )
                            }

                            else -> {
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
                        }
                    }
                }
            }
        }

        if (page == "root" && signedIn) {
            Spacer(Modifier.height(18.dp))
            OutlinedButton(
                onClick = onSignOut,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 18.dp),
                colors = ButtonDefaults.outlinedButtonColors(contentColor = Warning)
            ) { Text("Выйти из аккаунта") }
        }
    }
}

private val pageTitles = mapOf(
    "playback" to "Воспроизведение",
    "offline" to "Оффлайн и трафик",
    "notifications" to "Уведомления",
    "privacy" to "Приватность",
    "appearance" to "Внешний вид",
    "apps" to "Приложения и устройства",
    "info" to "Информация и поддержка"
)

@Composable
private fun RootPage(
    signedIn: Boolean,
    email: String,
    nonStop: Boolean,
    saver: Boolean,
    notifyUpdates: Boolean,
    motionOn: Boolean,
    update: ReleaseInfo?,
    onOpen: (String) -> Unit,
    onOpenProfile: () -> Unit
) {
    SectionTitle("SONORA")
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
        onClick = { onOpen("playback") }
    )
    ValueRow(
        2, Icons.Default.Notifications, "Уведомления",
        if (notifyUpdates) "Об обновлениях: вкл" else "Об обновлениях: выкл",
        "Пуши приложения и письма",
        onClick = { onOpen("notifications") }
    )
    ValueRow(
        3, Icons.Default.CloudOff, "Оффлайн и трафик",
        if (saver) "Экономия трафика" else "Стандартный расход",
        "Загрузки, кэш, мобильные сети",
        onClick = { onOpen("offline") }
    )
    ValueRow(
        4, Icons.Default.Lock, "Приватность", "Кто видит профиль",
        "Подписчики, плейлисты, история",
        onClick = { onOpen("privacy") }
    )
    ValueRow(
        5, Icons.Default.BrightnessMedium, "Внешний вид",
        if (motionOn) "Тёмная · анимации вкл" else "Тёмная · анимации выкл",
        onClick = { onOpen("appearance") }
    )
    ValueRow(
        6, Icons.Default.Computer, "Приложения и устройства", "Импорт из других сервисов",
        onClick = { onOpen("apps") }
    )
    ValueRow(
        7, Icons.Default.Info, "Информация и поддержка",
        "Версия ${BuildConfig.VERSION_NAME}" + if (update != null) " · есть обновление" else "",
        onClick = { onOpen("info") }
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
    onChange: (Boolean) -> Unit
) {
    Card(index = index, clickable = { onChange(!checked) }) {
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
        Switch(checked = checked, onCheckedChange = onChange)
    }
}

@Composable
private fun QualityRow(index: Int, title: String, kbps: Int, onChange: (Int) -> Unit) {
    val options = listOf(96, 160, 320)
    ToggleLikeRow(
        index = index,
        icon = Icons.Default.Download,
        title = title,
        value = SonoraPrefs.qualityLabel(kbps),
        hint = "Нажми, чтобы сменить",
        onClick = { onChange(options[(options.indexOf(kbps).coerceAtLeast(0) + 1) % options.size]) }
    )
}

@Composable
private fun ToggleLikeRow(
    index: Int,
    icon: ImageVector,
    title: String,
    value: String,
    hint: String,
    onClick: () -> Unit
) {
    Card(index = index, clickable = onClick) {
        IconBadge(icon)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(title, color = Color.White, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(value, color = Accent, fontSize = 13.sp, modifier = Modifier.padding(top = 2.dp))
            Text(hint, color = Muted, fontSize = 11.sp, modifier = Modifier.padding(top = 1.dp))
        }
        Icon(Icons.Default.Refresh, null, tint = Muted, modifier = Modifier.size(18.dp))
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
            .clip(CircleShape)
            .background(PanelAlt),
        contentAlignment = Alignment.Center
    ) {
        Icon(icon, null, tint = Accent, modifier = Modifier.size(18.dp))
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
    content: @Composable RowScope.() -> Unit
) {
    val shape = RoundedCornerShape(16.dp)
    val base = Modifier
        .fillMaxWidth()
        .padding(horizontal = 18.dp)
        .staggerEnter(index)
        .clip(shape)
        .background(Panel)
    val wrapped = if (clickable != null) base.then(Modifier.pressScale(onClick = clickable)) else base
    Box(wrapped.padding(14.dp)) {
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

/**
 * The three privacy switches. Kept public so the profile screen and the settings page
 * render exactly the same contract, and so a change from either place persists at once.
 */
@Composable
fun PrivacyToggles(startIndex: Int = 0) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var followersVisible by remember {
        mutableStateOf(SonoraPrefs.bool(context, SonoraPrefs.PRIVACY_FOLLOWERS, true))
    }
    var playlistsVisible by remember {
        mutableStateOf(SonoraPrefs.bool(context, SonoraPrefs.PRIVACY_PLAYLISTS, true))
    }
    var historyVisible by remember {
        mutableStateOf(SonoraPrefs.bool(context, SonoraPrefs.PRIVACY_HISTORY, false))
    }
    ToggleRow(
        startIndex, Icons.Default.AccountCircle, "Подписчики и подписки",
        "Показывать, на кого ты подписан и кто подписан на тебя.",
        followersVisible
    ) {
        followersVisible = it
        SonoraPrefs.setBool(context, SonoraPrefs.PRIVACY_FOLLOWERS, it)
        scope.launch(Dispatchers.IO) { ProfileApi.pushPrivacy(followersVisible, playlistsVisible, historyVisible) }
    }
    ToggleRow(
        startIndex + 1, Icons.Default.Download, "Плейлисты",
        "Публичные плейлисты видят другие пользователи и сайт.",
        playlistsVisible
    ) {
        playlistsVisible = it
        SonoraPrefs.setBool(context, SonoraPrefs.PRIVACY_PLAYLISTS, it)
        scope.launch(Dispatchers.IO) { ProfileApi.pushPrivacy(followersVisible, playlistsVisible, historyVisible) }
    }
    ToggleRow(
        startIndex + 2, Icons.Default.Visibility, "Недавно прослушано",
        "История прослушивания в твоём публичном профиле.",
        historyVisible
    ) {
        historyVisible = it
        SonoraPrefs.setBool(context, SonoraPrefs.PRIVACY_HISTORY, it)
        scope.launch(Dispatchers.IO) { ProfileApi.pushPrivacy(followersVisible, playlistsVisible, historyVisible) }
    }
}

private fun openUrl(context: Context, raw: String) {
    runCatching {
        context.startActivity(
            Intent(Intent.ACTION_VIEW, Uri.parse(raw)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        )
    }
}
