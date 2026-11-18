# Lane study and SONORA adaptation plan

## Scope and evidence

This is a feature/architecture study of the public Lane materials, not a reverse-engineering of private endpoints or a claim about hidden internals.

Lane's published Terms describe it as a personal music player/library manager. It says Spotify and SoundCloud APIs are used for metadata (title, artist, cover, etc.), and that Lane does not itself provide third-party audio, store or distribute those audio files. Therefore, public information does not establish Lane as a music streaming backend. Claims about its proprietary backend, stream extraction, or private server behavior cannot be verified from the available public evidence.

Public Lane feature announcements (v1.4) mention: artists/albums in library, profiles, song links, likes, comments, improved search, chart/country recommendations, downloads, playlists, streaming optimization, badges, and collaborative playlists/friends.

## SONORA design inspiration (implement original code; do not copy Lane code)

### Unified source model
- Provider identity is mandatory for each track reference.
- Metadata records: title, artists, album, artwork, duration, source URL, provider ID, rights/license state, availability state, last checked.
- Playback records are separate from metadata records. Only providers returning a permitted playable URI or native authorized playback integration are playable.
- Do not expose metadata-only hits as playable. External source link remains available.

### Library and playlists
- Local user library: tracks, albums, artists, playlists, likes, history.
- Playlist item stores a provider-specific reference plus normalized display metadata snapshot; avoid assuming a track ID is globally unique across providers.
- Import: user pastes a playlist URL or uploads CSV. Parse only public/authorized playlist metadata; show preview, provider badges, duplicate handling, unmatched rows, and confirm import.
- Multi-provider playlist: items can coexist; playback queue skips unavailable items with a visible reason.
- Smart playlist rules: genre, artist, year, duration range, provider, liked state, play-count/history criteria. Rules run locally/server-side against SONORA's own catalog/library.
- Collaborative playlist: owner, collaborators, role/permission, revision, optimistic concurrency, and audit history.

### Playback pipeline
1. User selects track.
2. Resolve provider adapter using provider+provider ID.
3. Adapter checks availability/authorization and returns an allowed playback mode: direct permitted stream, provider SDK/app handoff, local file, or external link.
4. Player prepares source; buffering/loading/error state is visible.
5. Start playback only when a real supported source is resolved.
6. Record play event after meaningful playback threshold; debounce duplicate events.
7. Persist queue/session state and restore safely after process death.

### Android
- Kotlin/Compose + Media3 for permitted streams/local media.
- MediaSessionService for background audio, lock-screen/notification controls, audio focus and headset actions.
- Room cache for metadata, library, queue, playlist state, download jobs, and sync outbox.
- WorkManager for resilient authorized downloads, metadata refresh and retries.
- SAF-based user-selected local folders; respect Android scoped storage.
- Offline: only locally owned or explicitly authorized downloadable files. Store file checksum, provider/license provenance, and size; avoid caching unauthorized third-party streams.
- Downloads: queue, progress, pause/resume, cancel, retry, deduplicate, integrity validation, storage quota and cleanup.
- Playback features: gapless, crossfade (configurable), repeat, shuffle, speed/pitch-preserving speed adjustment, sleep timer, queue drag-reorder, per-track resume position, lyrics when licensed/available, equalizer only when platform audio capabilities permit.

### Web
- Unified player state and queue shared across route transitions.
- Responsive library/playlist/artist/album pages; sticky mini-player.
- Import preview flow, provider badges, matched/unmatched tracks, duplicates and confirmation.
- Source availability labels (Playable, Authorized app handoff, Local, Metadata only, Unavailable).
- No false play button for metadata-only results.

### Recommendations (first-party SONORA signals)
- Seed from explicit likes, playlist adds, follows, play completion, skips, repeat listens, search intent.
- Use explainable weighted signals and diversity constraints: avoid same artist/album flooding; rotate genres and new-to-user items.
- Initially implement simple deterministic scoring; collect opt-in preference signals; no third-party tracking.
- Popularity charts only where provider supplies authorized chart data or SONORA's own aggregate counts.

### Backend/API
- Provider adapters with timeout, rate limit, bounded concurrency, caching, normalized error states.
- Search fan-out uses per-provider timeout and partial-success results.
- Track provider health separately from search-result count.
- Playlist endpoints: CRUD, item reorder, import preview/confirm, smart-rule validation, collaboration permissions.
- Downloads are client-side for user-owned/authorized files; server does not proxy restricted media.
- Avoid secret keys in mobile/web clients; OAuth state/PKCE, secure token storage, scoped access.

### Implementation priorities
P0: API contract audit; fix metadata/playable separation; reliable player state, queue, auth persistence.
P1: playlist import (URL/CSV) with preview; playlist cross-provider IDs; likes/history; Android playback service.
P2: offline authorized files, downloads manager, smart playlists, recommendations, lyrics.
P3: collaborative playlists, profiles/follows, badges, seasonal listening recap.

## Public reference material
- Lane official website: https://sklane.com/ru
- Lane Terms: https://sklane.com/ru/terms-of-service
- Lane Devs public announcement channel: https://t.me/s/lane_devs
- Android Media3 docs: https://developer.android.com/media/media3
- Android MediaSessionService docs: https://developer.android.com/media/media3/session/background-playback
- Spotify Android App Remote: https://developer.spotify.com/documentation/android
- Apple MusicKit: https://developer.apple.com/documentation/musickit

## Important limitation
This plan is an architectural translation, not a completed feature implementation. The site/APK code must be changed and tested in follow-up commits before any feature is marked shipped. No private API scraping, token/cookie extraction, DRM circumvention, or unauthorized stream downloading is included.
