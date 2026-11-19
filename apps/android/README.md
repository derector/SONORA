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
