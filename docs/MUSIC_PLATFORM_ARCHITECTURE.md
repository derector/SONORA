# SONORA Music Platform Architecture Specification

Updated: 2026-11-18

## Platform
SONORA Web (Next.js), Android (Kotlin/Compose), API (Fastify/Node), PostgreSQL/Supabase, Railway deployment and GitHub Actions Android builds. Web and Android share canonical provider IDs and account data. Target operating cost is zero where free tiers permit.

## Track model
Normalize title, artist(s), album, artwork, duration, genres/tags, release date, language, explicit flag only when provided, ISRC if available, provider/providerTrackId, provider page, authorized playback URL, playback type, playable state, download permission, license name/URL, attribution, rights-check timestamp and source availability. Unknown data remains unknown.

## Streaming
Progressive HTTP transfers audio continuously and may support byte ranges and seek. HLS uses playlists and audio segments with variants. DASH uses an MPD manifest and representations/segments. CDN caches authorized content near users. Buffers hold audio ahead of the playhead. Protected platforms may require OAuth, DRM, expiring tokens, subscription, territory and device entitlement. Catalog metadata does not imply a playable stream.

## Android engine
Use Media3 ExoPlayer, one playback controller, MediaSession and MediaSessionService for background audio. Support play/pause/seek/next/previous, queue, repeat/shuffle, audio focus, headphone unplug behavior, notification and lock-screen controls, Bluetooth buttons, playback resumption, format handling and meaningful errors. MediaLibraryService/Android Auto can be later work. Do not claim background playback tested without device QA.

## Product features
Home: Continue Listening, recently played, new releases, favorites, curated moods, popular and personalized rows.
Search: tracks, artists, albums, playlists, providers; suggestions, history, typo tolerance, transliteration if feasible, filters, pagination, deduplication.
Discover: Trending, Latest, independent music, genres, moods, hidden gems; provider badges and playability state.
Track: play/pause, queue, play next, favorite, playlist, source link, artist/album navigation, lyrics, permitted download.
Artist: profile, discography, popular tracks, releases, similar artists, follow, radio.
Album: artwork, credits, release date, tracklist, play/shuffle/save.
Playlist: create/edit/rename/description/cover/privacy, add/remove/reorder, share/export list, play/shuffle, save queue.
Favorites: account-synced library.
History: starts/completions/skips/listened duration/device/provider, privacy controls.
Radio: seed from track/artist/album/genre/mood/playlist; widen discovery gradually; avoid repeated artists.
Lyrics: permitted lyric provider, timed lines/words if available, font/size/color/sync offset. Lyrics rights are separate from audio rights.
Queue: local queue, Play Next, Add, reorder/remove/clear, persist, optionally sync; conflict resolution by versioned operations.
Shuffle: standard and smart suggestions inserted visibly; repeat Off/All/One.
Crossfade: selectable duration only where player/source support it; gapless where compatible.
Sleep timer: presets/custom/end-of-track.
EQ: bass/treble/bands/presets/balance only if the engine supports it.
Quality: Auto/data-saver/low/normal/high/lossless only when source/decoder provide it; never guess bitrate.
Offline: local managed files differ from transient cache. Download only if provider and license explicitly allow it. Check space, format, integrity, checksum, progress/retry/cancel/delete. Never extract protected commercial caches or bypass DRM.
Settings: language/theme/data saver/quality/EQ/crossfade/gapless/timer/notifications/privacy/offline/provider connections.
Notifications: artwork/title/artist and controls synchronized with media session.
Future: widgets, Android Auto, Cast, Wear OS subject to platform support and QA.

## Recommendation system
Use actual feedback: likes, follows, completed listening, skips, repeats, recency, artists, genre/mood/tags, release freshness, diversity and source availability. Penalize early skips and explicit not-interested; exclude blocked artists and unavailable or rights-ineligible items. Apply time decay and diversity. Explanations must be grounded. Candidate rows: Daily Mix, Discover, Similar Tracks, Artist Radio, Mood Mix, Fresh Releases, Because You Like. Do not copy protected/trademarked playlist names as SONORA branding.

## Provider adapters
Independent Search, Trending/Latest, Track Resolve, Artist/Album/Playlist metadata, Availability, Rights/Attribution and Health. Normalize, paginate, rate-limit, timeout, cache and isolate failures. Metadata never proves playability.

Current:
- Audius: existing official public adapter; reject gated/non-streamable.
- Jamendo: existing adapter; server client ID; obey API terms and track license filters; attribution.
- Internet Archive: narrow search, item metadata lookup, inspect files and formats, reject ZIP/archive bundles and non-audio. Verify rights before playback; search result alone is not stream.
- ccMixter: query results may contain sample ZIPs; inspect format/license, reject archives from normal player, retain source/license/artist attribution.
- Spotify: metadata/official embed/SDK differ from direct audio access; playback remains provider-controlled and policy/subscription limited. Do not put Spotify audio in SONORA unified player without written clearance.
- VK Music: VK ID login does not grant music catalog access. Use documented permitted endpoints, partner entitlement or links. Avoid private endpoints, token/cookie extraction, client impersonation or subscription circumvention.
- Apple Music: Apple Music API/MusicKit catalog, library and subscriber playback need authorization/entitlement. No redistribution or DRM extraction.
- Yandex Music: use only documented or explicitly authorized access; metadata is not playback permission.
- Deezer/SoundCloud/Audiomack: only verified official API, embeds and OAuth scopes; surface playback limitations.
- YouTube/YouTube Music: official Data API and allowed embeds; no audio stream extraction or private reverse-engineered endpoints.

## Provider status UX
States: playable, preview_or_embed, metadata_only, external_link, unavailable, needs_auth, region_restricted, rights_unverified. Show source, attribution and rights where relevant. Provider failure must not break other search results.

## Authentication and privacy
Email OTP, profile, persistent refresh, logout, device sessions, OAuth minimal scopes, secure Android token storage, HTTPS, validation, rate limits, CORS, safe URLs and no client secrets. Users disconnect integrations. Never ask for third-party passwords.

## Sync
Sync favorites, playlists, history, profile and settings. Store provider IDs, not brittle audio URLs. Refresh availability at playback time. Local queue works offline. Optional cloud queue uses versioned updates and conflict handling.

## Reliability
Async calls, bounded pagination, caching, timeout/backoff, 429 handling, content-type checks, redirect/range validation, diagnostics and meaningful retry. Offline fallback only to legal verified copies. Avoid arbitrary URL proxying.

## Legal/security
No DRM removal, paywall bypass, protected stream extraction, private endpoint scraping, copied/intercepted auth tokens or cookies, client impersonation. Use official APIs, partner access, licensed/public-domain/open-license audio. Track attribution and license per item. Apply non-commercial restrictions where applicable. Verify open-source licenses and comply with copyleft/dependency notices.

## GitHub audit
For each repository inspect license, activity, issues/security, APIs, auth, dependencies, secrets, Android compatibility and maintenance. Reuse patterns, not code blindly. Repositories for study: cromaguy/Rhythm, austinried/subtracks, ScnaNner/LightMusic, ozztec/kittytune, Ibnuananta/OpenTune, soupashh-ship-it/OmniTune, rsgarrido/sazanami, yuezhix/MiniSpotifyPlayer, dCataliNN/cadence, blazenxt/free-music-search-api.

## Priorities
P0: auth/session, API health, Audius/Jamendo real playback/search, unified player, favorites, playlists, history, availability states, web/Android parity.
P1: cross-provider search/dedup, recommendations, Internet Archive and ccMixter adapters with rights gates, lyrics, permitted offline, persistent queue, EQ/crossfade.
P2: official OAuth/catalog connections, provider embeds, MediaLibrary/Android Auto, Cast, widgets, advanced statistics and AI discovery.

## Release gates
Inspect exact branch and files, preserve existing functionality, commit, build web/API, deploy and verify production, build APK via Actions, inspect artifact/signature/package/version. Device QA must cover playback, background, notifications, sessions, downloads and offline. Separate build/signing/device test status. Never describe untested features as working.


## Research report links and corrections

Live probe: Internet Archive Advanced Search returned JSON records with identifier/title. Search result is not a playable file; item metadata and rights verification are mandatory. Live ccMixter query returned a JSON item with a ZIP archive of FLAC texture snippets, illustrating why file-type checks must precede playback. Avoid blindly treating archive bundles as tracks.


Provider scan (agent research, 2026-11-18; official docs must be reconfirmed before integration):
- Internet Archive: promising metadata/archive search, item-by-item rights and file verification required.
- ccMixter: API records and CC attribution data; reject sample-pack archives.
- FreePD: no confirmed API; scraping is fragile, do not implement scraper without permission/feed.
- Musopen: token/API and per-recording rights need verification.
- Freesound: sound effects/field recordings, not main music provider; keep separate SFX feature.
- Mixkit: no reliable public API found; do not scrape.
- Pixabay Music: public API does not confirm a usable music catalog endpoint.
- Free Music Archive: API/hotlink restrictions, not a quick integration.
- Radio Browser: live radio, distinct provider type from on-demand track catalog.

References:
- Android Media3 background playback: https://developer.android.com/media/media3/session/background-playback
- Android Media3 player: https://developer.android.com/media/implement/playback-app
- Spotify Android App Remote SDK: https://developer.spotify.com/documentation/android
- Spotify playlist model: https://developer.spotify.com/documentation/web-api/concepts/playlists
- Spotify recommendations: https://www.spotify.com/uk/safetyandprivacy/understanding-recommendations/plain
- Apple Music API: https://developer.apple.com/documentation/applemusicapi
- Spotify policy: https://developer.spotify.com/policy
- Internet Archive: https://archive.org/advancedsearch.php
- ccMixter: https://ccmixter.org/query-api
- Freesound API: https://freesound.org/help/developers/
