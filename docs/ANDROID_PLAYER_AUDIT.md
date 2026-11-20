# SONORA Android Player Audit (2026-11-18)

## Existing implementation observed
- Native Kotlin/Compose app in `apps/android` on branch `android-native`.
- `PlaybackService.kt` extends Media3 `MediaSessionService`, creates ExoPlayer and MediaSession, and releases them on destroy.
- `AndroidManifest.xml` already declares internet/network state, foreground playback service permissions and media playback service.
- `MainActivity.kt` connects via MediaController, can load/play tracks, build a queue from discovered tracks, and includes an offline library UI.
- `OfflineDatabase.kt` currently stores downloaded tracks only.
- `TrackDownloadWorker.kt` permits downloads only from Jamendo and HTTPS URLs, rejects text/json responses, and writes downloaded metadata into Room.

## Gaps to prioritize
1. Queue persistence: queue/index/position/shuffle/repeat are not persisted to Room. Persist provider track IDs and metadata, reconstruct URLs from provider APIs, avoid persisting expiring stream URLs.
2. Playback resumption: implement MediaSession playback-resumption callback and restore queue/current index/position quickly, including reboot/system resumption.
3. Noisy audio: verify pause behavior on headset disconnect/audio becoming noisy. Keep audio focus handling delegated to Media3/system where appropriate; don't add redundant manual focus requests.
4. Crossfade: investigate availability for the project's pinned Media3 version before adding; only enable for compatible non-live/non-DRM sources and add a user setting.
5. Download integrity: record file size, checksum and state; cleanup partial files on retry/failure; verify MIME/response and provider permission before enqueue and after completion. Add quota/storage controls.
6. Android Auto: prepare MediaLibraryService browsing only after current single-session flow and persisted queue are stable; review Google compatibility and test via emulator.
7. Track identity: use provider-qualified stable IDs to prevent collisions across catalogs.

## Suggested phases
- P0: queue persistence + playback resumption, noisy-output pause behavior, stable provider-qualified IDs.
- P1: download queue/state/size controls and robust cancellation/retry.
- P2: crossfade settings, richer library browsing, MediaLibraryService / Android Auto.
- P3: quality settings, EQ, sleep timer and advanced controls.

## References
- https://developer.android.com/media/media3/session/player
- https://developer.android.com/media/media3/session/background-playback
- https://developer.android.com/media/media3/session/control-playback
- https://developer.android.com/media/implement/playback-app
- https://developer.android.com/media/implement/surfaces/mobile#supporting-media
- https://developer.android.com/media/media3/exoplayer/downloading-media
- https://developer.android.com/media/optimize/audio-focus

This audit documents recommendations only. No Android code changes are included in this commit.

## Implementation update (2026-11-19, integration branches)

The following changes are now present in the stacked Android work branches and are awaiting final integration review:

- PR #56: queue and current-track matching use provider-qualified media IDs.
- PR #57: `PlaybackStateStore` persists queue metadata, current index, position, shuffle/repeat and play intent. Provider stream URLs are not persisted; remote tracks are resolved again when the app starts. Local file URIs are restored only when the file still exists.
- PR #58: `PlaybackService` implements Media3 1.5.1 `MediaSession.Callback.onPlaybackResumption` and registers `MediaButtonReceiver`. Remote tracks are resolved on a bounded executor. If the former current track cannot be restored, playback starts at position zero on the first playable track.

### Verification status

- PR #56 Android APK workflow: passed.
- PR #57 Android APK workflow: passed; debug artifact produced. This confirms compilation/package creation, not playback correctness on a physical device.
- PR #57 general CI: passed.
- PR #58 general CI: queued/running at the time of this audit update.
- PR #58 Android APK workflow: not yet confirmed. The stacked feature PR targets another feature branch, while the Android APK workflow filters pull requests by the `android-native` base branch. The integration PR #59 targets `android-native` and is intended to obtain that build.
- Physical-device verification remains outstanding: process kill/relaunch, headset/Bluetooth resumption, lock-screen controls, queue ordering, seek restoration, offline-track restoration, and offline/network failure behavior.

Do not treat these changes as released. PRs remain drafts; no merge or production deployment has been performed.
