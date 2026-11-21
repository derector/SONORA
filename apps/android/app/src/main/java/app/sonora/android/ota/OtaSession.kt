package app.sonora.android.ota

import android.content.Context
import android.content.Intent
import app.sonora.android.MainActivity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.io.File

/**
 * Process-wide UI state of the update flow.
 *
 * It lives outside the activity on purpose: the notification tap creates the activity, a
 * manual check runs in a coroutine that outlives a rotation, and the install round-trip
 * leaves the app for the unknown-sources Settings screen and comes back — possibly into a
 * recreated activity — where the remembered APK has to be offered again without downloading
 * anything a second time.
 */
data class OtaUiState(
    /** The newer release offered by the sheet, or null when there is nothing to offer. */
    val release: ReleaseInfo? = null,
    val sheetVisible: Boolean = false,
    /** A manual check is in flight (spinner on the Настройки row). */
    val checking: Boolean = false,
    /** The install grant is missing, so the UI shows its explainer before Settings. */
    val needsInstallPermission: Boolean = false,
    /** The APK to hand to the installer once the user is back from Settings. */
    val pendingInstallFile: File? = null,
    /** One-shot toast text; the UI reads it and calls [OtaSession.consumeToast]. */
    val toast: String = ""
)

object OtaSession {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val _state = MutableStateFlow(OtaUiState())
    val state: StateFlow<OtaUiState> = _state.asStateFlow()

    /** Cold start / resume: recomputes the badge from the stored release. */
    fun refresh(context: Context) {
        val available = OtaUpdate.availableRelease(context)
        _state.update { current ->
            current.copy(
                release = available,
                // A release that stopped being an offer also closes its own sheet.
                sheetVisible = current.sheetVisible && available != null
            )
        }
    }

    /**
     * Handles the intent a notification carried. SHOW_UPDATE opens the in-app sheet for the
     * stored release; INSTALL_READY resumes straight into the installer for the downloaded
     * APK. Anything else still refreshes the badge, so the row never lies.
     */
    fun handleIntent(context: Context, intent: Intent?) {
        when (intent?.action) {
            MainActivity.ACTION_SHOW_UPDATE -> {
                refresh(context)
                _state.update { it.copy(sheetVisible = it.release != null) }
            }
            MainActivity.ACTION_INSTALL_READY -> {
                val apk = OtaPreferences.readyApkFile(context)
                if (apk != null) install(context, apk) else refresh(context)
            }
            else -> refresh(context)
        }
    }

    /** Returning from the unknown-sources Settings screen finishes the interrupted install. */
    fun onResumed(context: Context) {
        val pending = _state.value.pendingInstallFile ?: return
        if (!OtaInstaller.canInstallPackages(context)) return
        _state.update { it.copy(pendingInstallFile = null, needsInstallPermission = false) }
        install(context, pending)
    }

    fun openSheet(context: Context) {
        refresh(context)
        if (_state.value.release == null) {
            _state.update { it.copy(toast = "Обновлений нет — установлена последняя версия") }
            return
        }
        _state.update { it.copy(sheetVisible = true) }
    }

    fun closeSheet() {
        _state.update { it.copy(sheetVisible = false) }
    }

    /** «Не сейчас»: remembered per tag, so this exact release is never offered again. */
    fun dismissRelease(context: Context) {
        val release = _state.value.release ?: return
        OtaPreferences.dismiss(context, release.tagName)
        _state.update {
            it.copy(sheetVisible = false, release = null, toast = "Обновление ${release.versionLabel} отклонено")
        }
    }

    fun startUpdate(context: Context) {
        val release = _state.value.release ?: return
        OtaUpdate.startDownload(context, release)
        _state.update { it.copy(toast = "Загружаем обновление ${release.versionLabel}…") }
    }

    fun cancelDownload(context: Context) {
        OtaUpdate.cancelDownload(context)
    }

    /** The only place that talks to the system installer. */
    fun install(context: Context, apk: File) {
        val invalidReason = OtaUpdate.validateReadyApk(context, apk)
        if (invalidReason != null) {
            OtaPreferences.clearReadyApk(context)
            val latestRelease = OtaUpdate.availableRelease(context)
            if (latestRelease != null) OtaUpdate.startDownload(context, latestRelease)
            _state.update {
                it.copy(
                    pendingInstallFile = null,
                    needsInstallPermission = false,
                    toast = if (latestRelease != null) {
                        "$invalidReason. Скачиваю актуальную версию ${latestRelease.versionLabel} заново."
                    } else {
                        "$invalidReason. Установлена последняя доступная версия или требуется новая проверка."
                    }
                )
            }
            return
        }
        when (OtaInstaller.launch(context, apk)) {
            // Keep the verified APK metadata until Android reports the update installed.
            // If the user cancels the system confirmation, the same file remains reusable.
            OtaInstaller.Outcome.LAUNCHED -> Unit
            OtaInstaller.Outcome.NEEDS_PERMISSION ->
                // The APK stays remembered: once the grant is given the user is back here.
                _state.update { it.copy(pendingInstallFile = apk, needsInstallPermission = true) }
            OtaInstaller.Outcome.NO_FILE ->
                _state.update {
                    it.copy(pendingInstallFile = null, toast = "Файл обновления потерян. Скачай его заново")
                }
            OtaInstaller.Outcome.NO_HANDLER ->
                _state.update {
                    it.copy(pendingInstallFile = null, toast = "На устройстве нет приложения для установки APK")
                }
        }
    }

    /** The user accepted the explainer: go to the one system screen we cannot avoid. */
    fun openInstallSettings(context: Context) {
        _state.update { it.copy(needsInstallPermission = false) }
        OtaInstaller.openUnknownSourcesSettings(context)
    }

    fun declineInstallSettings() {
        _state.update { it.copy(needsInstallPermission = false, pendingInstallFile = null) }
    }

    /** Manual «Проверить обновления»: progress first, then an honest result. */
    fun checkNow(context: Context) {
        if (_state.value.checking) return
        _state.update { it.copy(checking = true) }
        scope.launch {
            when (val result = OtaUpdate.check(context, notify = false)) {
                is OtaUpdate.CheckResult.UpToDate ->
                    _state.update { it.copy(checking = false, toast = "Уже установлена последняя версия") }
                is OtaUpdate.CheckResult.UpdateAvailable ->
                    _state.update {
                        it.copy(
                            checking = false,
                            release = result.release,
                            sheetVisible = true,
                            toast = "Доступно обновление ${result.release.versionLabel}"
                        )
                    }
                is OtaUpdate.CheckResult.Dismissed ->
                    _state.update {
                        it.copy(
                            checking = false,
                            toast = "Есть обновление ${result.release.versionLabel}, но ты уже от него отказался"
                        )
                    }
                is OtaUpdate.CheckResult.Failed ->
                    _state.update { it.copy(checking = false, toast = "Не удалось проверить обновления: ${result.reason}") }
            }
            refresh(context)
        }
    }

    fun consumeToast() {
        if (_state.value.toast.isNotEmpty()) _state.update { it.copy(toast = "") }
    }
}
