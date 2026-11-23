# SONORA Universal Music Discovery & Import Engine

Implemented in `apps/api/src/discovery.ts` (registered from `index.ts`).

## Legal boundary (spec §6, `UNIVERSAL_SEARCH_AND_IMPORT_RESEARCH.md`, `MUSIC_PLATFORM_ARCHITECTURE.md`)

No DRM bypass, no scraping of paid/auth walls, no extraction of protected full
audio. Every `DiscoveryResult` carries a per-result `access` status:

| access        | meaning                                                        |
|---------------|----------------------------------------------------------------|
| `open`        | licensed full audio SONORA may stream directly                  |
| `preview`     | official short preview supplied by the source's own API         |
| `stream_only` | playable only via the source's official player/embed            |
| `external`    | link to the source page only; no audio                          |
| `metadata`    | identifiers/credits only, no audio at all                       |

Adapters never surface an `audioUrl` that is not openly licensed
(CC/PD verified per item); platform adapters only pass through the exact
preview URLs their official APIs return — full-track URLs are never
constructed. `POST /discovery/resolve` returns `found: true` **only** for
`open` audio; preview-only matches come back as `found: false` with a
`preview_alternative` so UIs can honestly show "полная запись недоступна,
есть 30s превью/оригинальная страница".

## Adapter matrix

| adapter id              | source                       | keys needed | statuses served        |
|-------------------------|------------------------------|-------------|------------------------|
| independent_collection  | Jamendo API (via `catalog.ts`) | `JAMENDO_CLIENT_ID` + mode | open |
| platform_stream_catalog | Audius public search         | none        | open / external        |
| open_archive            | archive.org (advancedsearch + files metadata, 6 items/8s) | none | open / external |
| open_license_index      | Openverse audio API          | none        | open                   |
| open_remix_archive      | ccMixter (`api/query`, official CC remix corpus) | none | open / external |
| platform_preview        | Apple iTunes Search API (`entity=song`, official 30s `previewUrl`, artwork 600x600) | none | preview / external |
| metadata_graph          | MusicBrainz recordings (`inc=isrcs`) | none | metadata (ISRC enrichment) |
| curated_open_catalogs   | GitHub allow-list via `GITHUB_CATALOG_REPOS=owner/repo[/path@ref]` — exact files only, no scanning | env allow-list | open / metadata |
| commercial_streaming    | Spotify Web API (client-credentials token cached with expiry) | `SPOTIFY_CLIENT_ID` + `SPOTIFY_CLIENT_SECRET` + `SPOTIFY_CATALOG_MARKET` | metadata and official external track link |
| deezer_public_catalog   | Deezer public search JSON    | `DEEZER_APP_ID` (gate) | preview / external |
| commercial_storefront   | Apple Music API, ES256-signed developer token (incl. `previews`) | `APPLE_MUSIC_TEAM_ID`+`APPLE_MUSIC_KEY_ID`+`APPLE_MUSIC_PRIVATE_KEY`, `APPLE_MUSIC_STOREFRONT` | preview / external |
| video_platform          | YouTube Data API v3          | `YOUTUBE_API_KEY` | stream_only (official embed) |
| social_metadata         | Last.fm `track.search`       | `LASTFM_API_KEY` | external |
| discography_database    | Discogs `database/search`    | `DISCOGS_TOKEN` | metadata |
| creator_audio_platform  | SoundCloud API v2 (OAuth client id) | `SOUNDCLOUD_CLIENT_ID` | stream_only / external |

Playback via provider SDKs (Spotify Playback, Apple MusicKit JS, YouTube
iframe API) is an app-side concern and out of scope for the API engine.

## Endpoints

- `GET /api/v1/discovery/search?q&limit&sources` — concurrent fan-out
  (Promise.allSettled, 9 s budget per adapter), merges + dedupes by
  ISRC first (iTunes `isrc` merges preview rows with open rows), else
  normalized artist+title with version noise stripped; duration
  mismatch >±10 s splits groups (`duration_conflict` caution). Access
  priority inside a group: open > preview > stream_only > external >
  metadata. Rate limit 30/min.
- `POST /api/v1/discovery/resolve {artist,title,isrc?,durationSeconds?}` —
  best licensed full audio from open adapters only, MusicBrainz ISRC
  verification, iTunes as preview fallback. Response
  `{found, track|null, matched_via: isrc|meta+duration|title-only,
  confidence 0..1, preview_alternative}`. Scoring reuses
  `scoreMatch`/`normalizeForMatch` from `import-core.ts` (#68).

Import jobs (`/api/v1/import/*`) reuse the engine through
`matchAgainstCatalog`: stage 1 stays Jamendo, stage 2 stays Audius, and a
new stage 3 (`runDiscoveryOpenPool` → Archive/Openverse/ccMixter open
audio) is consulted only when both legacy stages miss, reusing the same
`scoreMatch` threshold (0.55) and result rows. All endpoint response shapes
are unchanged; storing the new provider ids requires migration
`009_discovery_licensed_providers.sql`.
