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
The GitHub Actions workflow `.github/workflows/android-apk.yml` builds a debug APK on pushes to `android-native` and on manual dispatch. The artifact is named `SONORA-Android-debug`.

A debug APK is for installation/testing. A production release that can update over previous versions needs a stable private signing key stored as a GitHub Actions secret. Never commit a keystore or signing password.

## Playback and rights
Media3 runs playback in a foreground media session, so system media controls can operate while the app is backgrounded. Offline copies are only enabled when the API explicitly returns a provider download URL for a source/track whose license permits it. Streaming URLs are not treated as download permission.
