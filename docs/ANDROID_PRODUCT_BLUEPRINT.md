# SONORA Android product blueprint

## Product direction

Build a native Android music app that combines the strongest interaction patterns from Yandex Music, LANE, Spotify and Apple Music without copying their branding or bypassing their provider rules. The app shares the SONORA account, catalog, playlists and history with the web product, but owns a native Android playback and offline stack.

## Reference research

- Yandex Music: personalized recommendations use likes/dislikes, skips, genre and artist affinity, plus contextual signals. Its player includes an editable queue, repeat/shuffle, sleep timer and synchronized lyrics. Official help: https://yandex.ru/support/music/ru/my-wave-and-recommendation and https://yandex.ru/support/music/ru/listening-and-settings/player-functions
- Yandex Music offline mode: downloads are available in mobile apps; users can download individual tracks, albums and playlists, and manage offline mode. Its newer on-device recommendation mode uses a user-managed storage limit and can prefetch over Wi-Fi while charging. Official help: https://yandex.ru/support/music/ru/listening-and-settings/app-settings and https://yandex.ru/company/news/27-03-2026-02
- LANE: personal music library, playlist management and playback customization; external services are supported only through explicit integrations and their terms. Offline access is limited to authorized content. https://sklane.com/ru
- Spotify: Now Playing surfaces save, shuffle, repeat, queue and device-casting controls; queue editing is a first-class mobile flow. Offline downloads are playlist/library oriented and governed by plan/source restrictions. https://support.spotify.com/ca-en/article/now-playing/ https://support.spotify.com/us/article/play-queue/ https://support.spotify.com/ly-en/article/listen-offline/
- Apple Music: users add music to their library, download individual tracks/albums/playlists, and can view timed lyrics when available. https://support.apple.com/en-gb/118288 https://support.apple.com/en-us/109355

## SONORA visual language

- Dark graphite foundation, warm near-black surfaces, acid-lime accent, restrained gradients and high-contrast typography.
- Distinct SONORA identity: geometric S mark, animated audio pulse, subtle cover-derived ambient background.
- Navigation: Home, Search, Library, Downloads, Profile. The player is a persistent mini-player above navigation.
- Motion: short fade/scale transitions between tabs; artwork expands into the full player; no animation may delay playback controls or cause excessive battery use.
- App launch: Android SplashScreen API with SONORA icon, then a brief in-app logo/audio-wave transition. Respect Android system splash behavior and reduced-motion/accessibility preferences.

## Core screens

1. Home: For You, mood/energy mixes, trending, new releases, recently played, continue listening.
2. Search: federated search across authorized providers, filter by tracks/artists/albums/playable sources, deduplicate recordings.
3. Track and album pages: artwork, credits, source/license details, play, play next, add to queue, add to playlist, favorite, download when permitted.
4. Full player: artwork, animated background, title/artist, seek bar, elapsed/remaining time, shuffle, repeat, previous/play/next, queue, lyrics, sleep timer, speed and audio-quality controls where supported.
5. Library: liked tracks, playlists, albums, artists, history and local files.
6. Downloads: queue/progress/errors, downloaded tracks/albums/playlists, storage usage, Wi-Fi-only setting, remove downloads, offline-only mode.
7. Profile/settings: account, language, theme, audio quality, data saver, download rules, cache limit, privacy and connected providers.

## Android implementation

- Kotlin + Jetpack Compose + Material 3.
- AndroidX Media3 ExoPlayer and MediaSessionService for background playback, notification, lock screen, headset/Bluetooth controls and Android Auto readiness.
- Room for local offline catalog, download records, recent history and queue snapshot.
- WorkManager for persistent network-constrained file downloads and deferred sync.
- DataStore for user preferences; Android Keystore-backed encrypted storage for access/refresh credentials.
- Coil for artwork; cache artwork separately from audio.
- Minimum Android 8.0 (API 26). Keep target SDK current and test Android 8, 10, 13 and 15+.

## Source and rights rules

- SONORA API is the only app-facing integration point for provider catalogs. Provider client IDs/secrets remain server-side.
- A streaming URL is never treated as a download URL.
- Show a Download action only when the provider adapter explicitly returns a download URL and the track's license/terms permit offline copying.
- Audius tracks are currently streamable only when the official API marks them streamable and non-gated. Do not infer download rights from streamability.
- Jamendo is currently configured for non-commercial API use. Its known Creative Commons license metadata is preserved; only a separate provider download URL may feed the offline worker.
- Spotify, Apple Music, VK and other subscription catalogs require their own approved SDK/OAuth contracts. No scraping, private API reverse engineering, DRM bypass or account-password collection.
- Cross-provider matching uses identifiers such as ISRC where available, otherwise normalized title/artist/duration confidence. A match may suggest an alternate playable source; it must not replace an unauthorized audio stream.

## Recommendation engine

Start with transparent signals: likes, dislikes, saves, completed listens, skips, replay frequency, artist/genre affinity, playlist membership and recency. Add context (time/day, session intent and device) only when the user opts in or the signal is non-sensitive and clearly disclosed. Use a diversity pass to avoid repeating the same artist. Persist events through the shared API and cache a compact recommendation seed locally for offline sessions.

## Offline behavior

- Download single tracks and full albums/playlists when the provider explicitly authorizes it.
- Offer Wi-Fi-only, cellular-download toggle, storage quota, auto-cleanup and download queue controls.
- Use local playback first when a valid offline copy exists; otherwise fall back to the provider stream only when online and permitted.
- Keep local files in app-private storage unless the provider license explicitly permits export.
- An offline recommendation queue may only contain already-downloaded or locally owned tracks. Do not imply that new cloud catalog tracks can be fetched without a network.

## Release and quality gates

- Debug APK artifacts are for testing only.
- Production updates require a stable private signing key stored as a GitHub Actions secret; never commit keystores or signing passwords.
- Verify installation on Android 8+, cold start, login/refresh, catalog search, artwork loading, background playback, notification controls, headphone unplug behavior, offline download, offline playback, storage cleanup and update-over-install.
- A successful Gradle build is not proof of real-device playback or provider rights. Track each gate separately.
