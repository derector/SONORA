# SONORA Android app

Native Android client in `apps/android`, separate from the Next.js web client.

## Stack
- Kotlin 2.0.21, Android Gradle Plugin 8.7.3
- Jetpack Compose + Material 3
- AndroidX Media3 ExoPlayer + MediaSessionService
- Room for local offline-library metadata
- WorkManager for background file downloads
- OkHttp for the existing SONORA API
- EncryptedSharedPreferences for access-token and refresh-cookie storage

## Compatibility
- `minSdk 26` (Android 8.0)
- `targetSdk 35`
- API base URL matches the production web app API: `https://sonora-web-api-production.up.railway.app`
- Jamendo Client ID and all provider credentials remain on the server. The APK contains no provider secrets.

## Build
The GitHub Actions workflow `.github/workflows/android-apk.yml` builds APKs on pushes to `android-native`, `fix/**`, and `integration/**`, and on manual dispatch.

When all four `SONORA_ANDROID_*` signing secrets are present, it creates a versioned, stable-signed release APK named `SONORA-Android-release`. If signing secrets are absent, it creates a clearly labelled QA-only debug APK instead. A stable-signed release is required for an in-place update over an existing installation. Never commit a keystore or signing password.

The CI workflow also runs `assembleDebug` as a compile check. That job does not produce a distributable release artifact.

## Playback and rights
Media3 runs playback in a foreground media session, so system media controls can operate while the app is backgrounded. Offline copies are only enabled when the API explicitly returns a provider download URL for a source/track whose license permits it. Streaming URLs are not treated as download permission.

## Native player features
The Android player uses a Media3 playlist for queue playback, exposes seek, shuffle, repeat, playback-speed and volume controls, and can play provider-approved Jamendo downloads from app-private storage. Audius stream URLs are not treated as downloadable files.

## In-app updates (OTA)

SONORA learns about new APK releases and installs them without leaving the app. There is no
push service and no third-party SDK: the app reads the public
`https://api.github.com/repos/derector/SONORA/releases/latest` endpoint without a token.

1. **Check.** `OtaUpdate.schedule()` (from `MainActivity.onCreate`) registers WorkManager
   work `sonora-release-check` roughly every hour over Wi-Fi or mobile data with exponential
   backoff, plus `sonora-release-check-startup` 25 seconds after a cold start. The answer,
   the last-check timestamp and the dismissed tags live in the `ota_prefs` SharedPreferences
   file. A release is newer only when its parsed `vX.Y.Z` tuple is strictly greater than the
   current `versionName`; `versionCode` is the CI run number, so the packed
   `X*10000+Y*100+Z` form is never compared against it directly (see `OtaCore`).
2. **Notify.** A newer release posts the `sonora_updates` channel notification
   ("Доступно обновление SONORA"). Tapping it opens `UpdateSheet` inside the app. With
   notifications switched off nothing is posted and nothing is lost: the same release keeps a
   badge on the «Обновления» row in Настройки.
3. **Sheet.** Release notes (clipped to 300 characters), APK size, release date, current
   version, and the buttons «Обновить» / «Не сейчас». «Не сейчас» remembers the tag, so the
   same release is never offered twice.
4. **Download.** `UpdateDownloadWorker` streams the asset over the shared OkHttp client into
   `cacheDir/sonora-update.apk` (a `.part` file first, the way track downloads work),
   cross-checks Content-Length against the size GitHub reported, verifies the ZIP signature,
   and publishes determinate progress to the `sonora_downloads` notification. Re-tapping
   «Обновить» cancels and restarts; every failure path deletes the temporary file and reports
   an honest reason.
5. **Install.** `FileProvider` shares exactly that one file, and the APK goes to the system
   installer through `ACTION_VIEW` + `application/vnd.android.package-archive`. If the
   "install unknown apps" grant is missing, the app explains why in a dialog first and then
   opens the matching Settings screen; the downloaded APK is remembered, so returning to
   SONORA resumes the install without a second download. That Settings screen is the only
   system surface the flow can require.

Настройки → «Проверить обновления» runs the same check immediately, with a spinner and a
toast for "already latest", "update found" and "network error".

### Verifying without a device build

`aapt2` in the cached build-tools is x86-only, so a full Gradle build cannot run on this
arm64 host. `tools/verify-kotlin-frontend.sh` compiles every module source with
kotlin-compiler-embeddable 2.0.21 and the Compose compiler plugin against the classpath
Gradle already assembled (`android.jar` plus the transformed AAR `classes.jar` entries), with
a minimal `R`/`BuildConfig` stub in place of AGP's generated code.
`tools/ota-core-smoke.main.kt` runs the release parsing/comparison rules on a plain JVM.
