# SONORA Universal Search & Music Library Transfer

## Goal
Resolve a query (track/artist/album) to a canonical track identity and show actionable results inside SONORA, not only generic website links. Search engines may help discover official pages, but search-result pages are not playable audio and should not be converted into unauthorized stream URLs.

## Existing SONORA capabilities observed
- Web /search page already calls `GET /api/v1/search/music` and renders playable catalog tracks, artist results, and MusicBrainz metadata.
- Import page accepts pasted CSV/text, queries Jamendo for matches, then saves selected results to provider favorites. The selected platform label currently does not create a platform connection or change the search backend.
- Existing provider playback/favorites is restricted to supported providers, and playlist provider-track route validates Audius/Jamendo IDs.

## Research findings
### Keyless search/catalog APIs worth evaluating
- iTunes Search API: no key; structured song results, artwork and 30-second preview URLs. Preview is not a full-track stream. Rate-limit/backoff needed; silent empty responses may occur.
- Deezer public search: metadata, artwork and 30-second preview. Browser CORS restrictions mean backend proxy is preferable. Check error objects even when HTTP status is 200. Do not depend on a public shared CORS proxy in production.
- MusicBrainz: canonical recording/artist/release identity; metadata only. Must use descriptive User-Agent and respect 1 request/second rate guidance.
- Audius: existing integration, public stream routes and track IDs; only play verified streamable/non-gated tracks.
- Jamendo: existing official API integration; licensed catalog access and track-specific rights/URLs.
- Internet Archive: metadata API can discover files but license/rights and audio file availability must be checked before offering playable/downloadable status.
- Search engines: can return links to official track pages (Apple Music, Bandcamp, SoundCloud, YouTube, etc.). This is discovery only. A search result URL does not prove the track is streamable in SONORA; playback must use an official API, embed/SDK or an authorized preview/full-track route. Avoid scraping search pages, platform HTML, private endpoints, session cookies or bypassing DRM.

### Proposed result schema (normalized)
- `provider`, `providerTrackId`, `title`, `artist`, `album`, `durationSeconds`
- `artworkUrl`, `sourceUrl`, `audioUrl` (only authorized playable URL), `previewUrl` (explicit preview), `playable`, `playbackType` (`full`, `preview`, `embed`, `metadata`)
- `licenseLabel`, `licenseUrl`, `downloadAllowed`, `downloadUrl` (only when rights allow)
- `externalLinks[]` official destinations; no scraped or guessed audio URLs

### Universal search UX
1. Debounced query with parallel source calls, per-provider timeout and Promise.allSettled.
2. Tabs/filters: All, Playable, Previews, Artists, Albums, External links.
3. Track cards show exact source, playable status and preview/full badges.
4. Deduplicate by ISRC when present, otherwise normalized title + artist + duration tolerance. Keep provider-specific copies/IDs.
5. Direct play opens the SONORA player only for verified authorized audio; previews must clearly indicate preview length.
6. Add-to-library requires signed-in user and stable provider-qualified track ID.
7. Search engine links should appear under “Web matches” and open the actual official source. They must never masquerade as SONORA tracks.
8. Add user-visible search provider availability/timeout messages and rate-limit caching.

### Import/transfer roadmap
- CSV/JSON file import, robust parsing and playlist name/order retention.
- Spotify export (CSV or playlist track list): metadata matching only, no credentials required.
- Apple Music, YouTube Music, SoundCloud, VK Music, Yandex Music, Deezer: accept exported CSV/tracklist or official share links; add official OAuth/API imports only where provider terms and access support it.
- Spotify/Apple/YT playlist URLs: only use official API/OAuth or a user-provided export. Do not scrape logged-in web pages or use unofficial extraction.
- Match each source track to SONORA catalogs; candidate confidence should be metadata-based and explainable; user confirms ambiguous matches.
- Save to SONORA playlist with preserved order, duplicates policy, unmatched report, and partial retry. Favorites is not a substitute for playlist transfer.
- Android file import via system file picker (SAF), then same API matching workflow; do not require desktop or shell.

## Suggested phased implementation
1. Add iTunes Search API (keyless) to server-side music search. Preview only; add explicit 30-second label and source URL.
2. Add Deezer search backend with server-side proxy route only if robust quota/error handling and provider availability verified. Preview only.
3. Merge into existing `/api/v1/search/music` response schema and web UI. Keep existing Audius/Jamendo playback unchanged.
4. Add web-result discovery via a legitimate search API/provider only after choosing an API with free tier and no hidden scraping. Search result page links are external, not audio.
5. Implement playlist import to real SONORA playlists, with export format support and Android parity.
6. Add tests for provider timeouts, malformed JSON, duplicate metadata, missing preview, rights labels, empty/rate-limited API responses and playback status.

## Non-negotiable behavior
- Search results are not playable merely because an official web page exists.
- 30-second previews must never be presented as full-track playback.
- No stream ripping, DRM bypass, private platform APIs, session-cookie extraction, or scraping restricted platform pages.
- Display attribution/source and licensing for every external catalog item.
