# SONORA provider expansion research plan

Updated: 2026-11-18

## Project context
- Repo: https://github.com/derector/SONORA
- Web/API branch: `main`; native Android branch: `android-native`.
- Current direct playback providers: Audius and Jamendo.
- Goal: one discovery UI, provider-aware track cards, playlists/library, Android client, with an operating-cost target of €0/month.
- Do not create duplicate repos/backends or mix projects.
- User asked to investigate public workarounds and open source, but integrations must use official/public permitted access: no DRM circumvention, protected stream extraction, private endpoint use, stolen/copied session tokens/cookies, client impersonation, or bypassing paywalls.

## Research snapshot (verified public sources)
- Audius official API: https://docs.audius.co/developers/api/get-playlist
  - Open catalog/API suitable for track discovery and playback where the provider permits and marks streams accessible.
- Spotify Web Playback SDK: https://developer.spotify.com/documentation/web-playback-sdk
  - Official player SDK; playback access depends on Spotify requirements/account and developer policy.
- Spotify Developer Policy: https://developer.spotify.com/policy
  - Policy includes a prohibition on products integrated with streams/content from another service. Because SONORA is a multi-provider product, do NOT add Spotify playback SDK/stream integration unless Spotify provides explicit written authorization or policy clarification. Metadata/linking and outbound handoff must also be reviewed against policy and allowed scopes before implementation.
- Spotify Embeds: https://developer.spotify.com/documentation/embeds/tutorials/creating-an-embed
  - Official external embed/handoff option, subject to current policy and embed restrictions. Do not use as a means to extract the stream into SONORA's player.
- ccMixter Query API: https://ccmixter.org/query-api
  - Public Query API; results are per-upload, license is not blanket permission. CC BY, NC, SA, ND and sampling licenses have distinct conditions. See https://ccmixter.org/about and https://creativecommons.org/about/arts-culture/arts-culture-resources/legalmusicforremixing/
  - Candidate: research adapter only after parsing each track's metadata and license, rejecting incompatible licenses, and preserving artist attribution/source/license URL.
- Internet Archive:
  - Candidate search/metadata API, but collection/file rights vary item by item. Research API docs: https://internetarchive.readthedocs.io/en/stable/api.html
  - Do not assume an audio file is public domain just because it is hosted there. Check metadata, item/file access, rights/usage notes, audio format, stream byte ranges, and license before enabling playback/download.
- Freesound: https://freesound.org/docs/api/
  - Mostly sound effects/ambience; not a replacement music catalog. Consider only in a separate sound/ambient library and check item-specific CC license.
- MusicBrainz: metadata-only; never mark recordings playable.
- Free Music Archive: not a quick integration. Official developer information previously reviewed states API shutdown and direct hotlinking restrictions; no scraping or unauthorized proxying.
- Apple Music/MusicKit, Deezer, SoundCloud, Audiomack, VK Music, YouTube Music: research their current official APIs/SDKs and scope-specific rights before implementing. Catalog metadata, account/library import, preview, and full playback are separate permissions.

## Architecture to evaluate
Use a provider adapter rather than hardcoded source-specific logic:
- `providerId`, `providerTrackId`, `title`, `artist`, `album`, `duration`, `artwork`
- `availability`: `stream`, `preview`, `external`, `metadata_only`, `unavailable`
- `playbackKind`: `native_stream`, `official_embed`, `external_app`, `preview`, `none`
- `streamUrl` (only when official/permitted; never persist expiring URLs as durable IDs)
- `providerUrl`, `licenseId`, `licenseUrl`, `attribution`, `rightsCheckedAt`
- `isStreamable`, `isDownloadable` (source rights/policy derived, not guessed)
- provider-specific IDs and metadata retained for refresh and mapping.

## UI/UX roadmap
1. Provider chip/source badge and truthful playability state (playable, preview, external, metadata only).
2. Search aggregation, de-duplication, source filter, sort by relevance, pagination, and resilient provider error states.
3. Cross-provider track identity mapping (ISRC where legitimately supplied, title/artist/duration fallback with confidence and user-visible match handling).
4. Save favorites and playlists as provider IDs/metadata snapshots; sync to account; never copy provider audio without rights.
5. Recommendation feed based on real favorites/listening/skip signals, diversity, source eligibility and transparent reasons.
6. Artist/album pages, track credits, source links, license/attribution display.
7. Android playback polish: foreground service/media session, notification and headset/lockscreen controls, queue, background playback, download queue, storage/error handling, battery/network controls. Validate on Android 8+ devices before claiming runtime success.
8. Offline mode only for tracks whose license and provider rules permit downloads; record source/license/attribution in offline metadata and offer user deletion.
9. Provider health diagnostics, caching/rate limiting/backoff, timeout isolation, request logging without tokens, tests for provider normalization and rights filters.

## Candidate open-source references
- Legal free music search API architecture: https://github.com/blazenxt/free-music-search-api
  - Use only as architecture/reference, not copy code or accept its rights claims blindly. Check current license, upstream API terms and per-item metadata.
- Audius-focused player: https://github.com/dCataliNN/cadence
  - Provider abstraction, Audius direct official streams, metadata-only provider IDs, queue, shuffle, player controls. Review code/license before borrowing ideas.
- Self-hosted library/server options (for user's own audio, not commercial streaming catalog substitutes):
  - Navidrome: https://github.com/navidrome/navidrome
  - Koel: https://github.com/koel/koel
  - Ampache: https://github.com/ampache/ampache
  - Aurral: https://aurral.org/ (discovery/import/sync; inspect integrations individually)
  - Lumen: https://github.com/githubesson/lumen
  - These are architecture references or potential personal-library connectors, not automatic permission to relay other streaming services.

## Integration gates
Before implementing any new provider:
1. Confirm the provider's current official developer/API docs and free-tier costs.
2. Confirm whether full stream, preview, catalog search, account/library access, and download are each permitted.
3. Verify rights/license for the individual track, attribution requirements and territory restrictions.
4. Test provider endpoint and CORS/stream behavior from web and Android.
5. Ensure provider failure cannot break other sources; use rate limits, timeout and retry/backoff.
6. Add unit tests for parsing, rights/availability filtering, and source-specific behavior.
7. Review UI labels and source attribution.
8. Deploy only after build, test, and live health checks pass.

## Agent task protocol
Research agents should receive this document and `docs/AGENT_HANDOFF.md`, a single scope, exact branch and read-only boundary. Findings must include evidence URLs, files checked, confirmed facts vs guesses, risks, and prioritized actions. Agents may not touch production, credentials, or user data. Code changes are sequentially reviewed and tested; do not let agents edit overlapping files.


## Live API probes (2026-11-18)

Checked live endpoints before integration:
- ccMixter Query API: `https://ccmixter.org/api/query?f=json&search=ambient&limit=2` returned JSON records containing `upload_id`, `upload_name`, artist/user identifiers, tags, `file_page_url`, `license_url`, `license_name`, descriptions, and nested `files[]`. A sample result was a ZIP archive containing FLAC texture snippets, not a conventional music track. Do not mark ccMixter entries playable without inspecting their file types; reject archive/sample-pack files in the music player. Official docs support JSON, XML, CSV and other formats and document license filtering.
- Internet Archive Advanced Search: `https://archive.org/advancedsearch.php?q=mediatype%3Aaudio&fl%5B%5D=identifier&fl%5B%5D=title&rows=2&output=json` returned valid JSON with `response.numFound` and `response.docs[]` identifiers/titles. The broad query yielded millions of results, so production queries must be narrowed and followed by metadata lookup before playback. Search records are not playable URLs.
- Internet Archive item metadata: `https://archive.org/metadata/{identifier}`; inspect `files[]` and allow only verified audio formats with a separate rights check. Use the stable public download path by item ID/file name, not changing internal data-node hostnames.

### Integration gates from live probes
1. Search results do not prove audio file availability or license suitability.
2. Reject ZIP bundles, non-audio formats and unavailable files unless a verified playable path exists.
3. For ccMixter, preserve explicit attribution, license name/link, artist and source page. Do not assume every result is a song.
4. For Internet Archive, narrow searches and verify item metadata/file formats/rights before exposing playback. Never auto-label all Archive tracks Public Domain.
5. Adapter should use server-side fetch, bounded pagination, timeouts, caching and provider-isolated errors. Add diagnostic state; port to Android only after web adapter passes tests.


## Commercial-provider feasibility scan (agent research, pending source-by-source verification)

This scan is a planning signal, not legal approval. Check each provider's official terms before implementing any OAuth or embedded playback.

- Spotify: catalog metadata and official embed/player are separate from audio access. Full playback is premium/SDK-controlled; no direct audio URL. Because SONORA is a multi-provider product, policy prohibits certain stream/content integrations across services. Do not integrate playback in the unified SONORA player without written policy clearance. A metadata result can link to Spotify, but re-check API scope and branding requirements.
- Apple Music: official MusicKit / Apple Music API; catalog metadata and subscriber playback are provider-controlled. Requires user authorization/developer setup. Never extract/download protected files.
- Deezer: public metadata API and official embeds may be available, but playback limitations/subscription/access requirements must be verified against current official docs before build.
- SoundCloud: oEmbed and limited API paths may be viable for embeds/metadata; direct playback SDK/API access depends on official approval/access and terms.
- VK Music: no verified public third-party full-track playback SDK/API found in this scan. Treat results as metadata/deep links only. Avoid reverse-engineered private endpoints, app-token intercepts, session/cookie extraction or impersonation methods.
- Audiomack: API/oEmbed access appears limited; only implement verified public embed/metadata paths.
- YouTube Music: no official audio-only playback API. Keep video embeds only if terms and UX fit; do not extract streams or use private reverse-engineered endpoints.

Suggested future UI: provider-specific search result cards and "Open in provider" actions, clearly labeled embed/preview/playable modes; preserve SONORA's own full playback player for Audius, Jamendo and verified licensed open catalogs only.



## Research agent findings (2026-11-18)

The read-only catalog agent recommends the adapter schema separating full stream, preview, embed-only and metadata-only; each result should preserve source, license, license URL, attribution and download permission. Deduplicate by stable provider URL/ID and balance results across sources rather than letting one provider monopolize the result list.


Candidate scan (treat as research leads, reconfirm official terms before integration):
- Internet Archive: promising open metadata search; candidate audio records may have multiple formats and derivative files. Rights and file verification are item-specific.
- ccMixter: API and CC licensing metadata; results can include sample/archive bundles, so validate file formats and reject ZIP/sample packs as normal songs.
- FreePD: no confirmed API; do not scrape without permission or an approved data/feed route.
- Musopen: potential classical catalog; verify token/API and rights per recording before connecting.
- Freesound: primarily effects/field recordings, not an on-demand music catalog; keep it separate as a future SFX feature.
- Mixkit: no reliable official API confirmed; avoid scraping.
- Pixabay: public API not confirmed to provide a music catalog; do not claim music coverage from image/video API.
- Free Music Archive: limitations on API/hotlink use; not a quick integration.
- Radio Browser: live radio stations, not track-on-demand, so use a separate radio-provider model.

## Live Internet Archive probe

Advanced Search endpoint returned valid JSON, fields identifier/title/creator/licenseurl/format. The broad audio query returned a large catalog; production query should narrow by title and include only metadata in initial integration. A metadata probe confirmed that records can contain original MP3 plus unrelated derivatives. Initial integration therefore exposes metadata only and links to archive item page. Playback/download must remain disabled until a separate rights + file-format verifier is implemented and tested.

## Live ccMixter probe

Public query returned JSON with track/item ID, title, creator, source page, license name/URL, descriptions and file records. A returned sample was a ZIP archive containing FLAC texture snippets. This is a real reason to validate media types before showing a track as playable.

## Agent research run links
- Provider/catalog report: https://agent.tinyfish.ai/runs/999491f2-11ab-48ab-854f-0dd1e57a1a33
- Commercial-provider feasibility: https://agent.tinyfish.ai/runs/34af7b48-21b1-4f5b-95eb-ad9d0e0b511b
- Architecture audit: timed out and did not return a reliable report: https://agent.tinyfish.ai/runs/776039f1-2455-45c3-b351-3e3643fb6c12


## Provider integration expansion — 2026-11-19

User requested a broad investigation of public APIs, SDKs, open-source implementations and the LANE app's integration approach. Treat "API" as the intended meaning of "айпи"; raw IP addresses do not grant catalog access, credentials, or playback rights. Keep the integration compliant and reproducible: no DRM circumvention, reverse-engineered private endpoints, subscription bypass, token/cookie extraction, client impersonation, or scraping protected streams.

### LANE reference — metadata-first model
- Public LANE terms: https://sklane.com/ru/terms-of-service
- Public description says LANE uses Spotify and SoundCloud APIs for track search and metadata (title, artist, artwork); it does not provide or store third-party audio files. External playback/content access remains controlled by the provider.
- Public product page: https://sklane.com/en
- SONORA can adopt this separation: unified metadata discovery and track matching, followed by a clearly labeled provider handoff or an officially authorized provider player. Do not assume LANE has undocumented playback access or copy its implementation without evidence.

### Provider matrix and implementation gates

| Provider | Public/official integration | SONORA plan |
|---|---|---|
| Spotify | Web API for catalog metadata/search and user-authorized library/playlist functions; Web Playback SDK / playback control has Premium and strict platform/policy limits. | Start with metadata + provider deep links / official embeds where allowed. Do not mix Spotify streams/content into SONORA's multi-source player without written Spotify approval: Developer Policy prohibits products integrated with streams/content from another service. |
| SoundCloud | Public API access is application-reviewed; credentials are issued after an application. API terms prohibit downloading/storing content and restrict commercial use and mixing with other services. | Apply for official API access; metadata/search and official player/handoff only within approved scopes. No scraped client IDs or substitute credentials. |
| Apple Music | Apple Music API and MusicKit support catalog, user library, playlists, authorization and playback under Apple developer and subscriber requirements. | Separate adapter; evaluate developer token, Music User Token, storefronts, Android/Web MusicKit support and subscription entitlements. Never extract DRM or reuse browser session data. |
| TIDAL | Official Developer Platform provides REST API, Web/Android/iOS SDKs and embeds; OAuth and endpoint-specific access tiers/scopes apply. | High-priority research adapter. Verify current developer access, audio playback entitlements, commercial limits and approved Android SDK path before coding. |
| YouTube / YouTube Music | YouTube Data API for metadata/search plus official embedded player. | Search/list videos with attribution and open official player. No audio separation/extraction, background audio, offline copies, or replacement player. |
| Deezer | Public developer material and historical APIs exist, but current app registration/access and playback permissions must be confirmed with Deezer. | Research-only until current official access is verified. No unofficial endpoints or copied app tokens. |
| VK Music | VK API/OAuth does not itself grant music playback/catalog rights. | Research official partner/documented scopes only; otherwise provider link/handoff. |
| Yandex Music | No assumption that public/undocumented endpoints permit third-party playback. | Research official/partner access and contractual permissions; no private endpoint scraping or token reuse. |
| Audius | Official open API supports public read/search/track/user/playlist endpoints; writes require API credentials. | Active provider. Expand artist/album/playlist discovery and retain gated/streamable/license states. |
| Jamendo | Official API offers search/discovery and per-track license metadata. | Active provider. Keep license/attribution checks per track and preserve restrictions. |
| Internet Archive | Public search and metadata APIs; rights and playable file must be checked per item. | Candidate with narrow queries, file-format validation and item-level rights checks. |
| ccMixter | Public query API includes file, artist and license metadata; results may include sample packs/archives. | Candidate; inspect file type and license, reject archives from normal music playback. |

### Open-source reference investigation
- https://github.com/sonorahq/sonora — active multi-provider desktop client with Spotify, Apple Music, YouTube Music, Deezer, TIDAL, Subsonic and local files. Its public project statement explicitly rejects DRM circumvention, decrypted stream export, and subscription bypass. Study provider boundaries, OAuth, player handoff and source-specific adapters; do not copy code blindly. Repository is GPL-3.0-or-later, so any code reuse requires a deliberate license-compatibility review. Architecture reference only; not the same project as SONORA.
- https://sonorahq.org/docs/providers — provider setup and per-provider account/entitlement notes.
- https://github.com/Abhi9-Pr/Sonora — separate project with a multi-source abstraction and provider-qualified IDs; inspect license, upstream rights and implementation quality before borrowing architecture.
- https://github.com/dCataliNN/cadence — Audius-focused player; reference only, inspect license and current API compatibility.
- https://github.com/blazenxt/free-music-search-api — architecture reference only; verify every upstream provider and rights claim independently.

### Research evidence (official sources)
- Spotify Developer Policy: https://developer.spotify.com/policy
- Spotify Web API: https://developer.spotify.com/documentation/web-api
- Spotify compliance guidance: https://developer.spotify.com/compliance-tips
- SoundCloud public API access: https://help.soundcloud.com/hc/en-us/articles/115003446727-SoundCloud-Public-APIs
- Apple Music API: https://developer.apple.com/documentation/AppleMusicAPI
- TIDAL Developer docs: https://developer.tidal.com/documentation
- YouTube API Developer Policies: https://developers.google.com/youtube/terms/developer-policies
- Audius API: https://docs.audius.co/api/
- Jamendo API: https://developer.jamendo.com/v3.0/docs

### Delivery order
1. Implement a provider capability registry: search, metadata, user library, playlist read/write, official playback, embed, external handoff, download permission, auth method, territory and entitlement.
2. Implement Spotify + SoundCloud metadata adapters only after official app access is obtained; show source badges and provider links.
3. Prototype TIDAL and Apple Music adapters behind feature flags, beginning with metadata/auth and only enabling playback after verified access.
4. Add YouTube search + official embedded player as a video result type, not an extracted audio source.
5. Re-check Deezer, VK and Yandex official developer access; keep unavailable adapters disabled rather than using unofficial endpoints.
6. Extend artist/album/track identity resolution with ISRC where available, MusicBrainz recording IDs and confidence-scored metadata matches. Preserve provider-specific IDs and canonical URLs.
7. Add provider contract tests, auth/entitlement tests, source attribution tests, rate-limit/backoff, and a user-visible capability label for each result.
8. Run web and Android device QA separately. Do not merge, deploy or apply database migrations without the established release gate.



## Acceptance test: молодой рубль — шкёрт (activated 2026-11-19)

The user explicitly requested that this artist test now be run. This supersedes the earlier deferred status.

Reference catalog evidence:
- Spotify album: https://open.spotify.com/album/2jek5OrDxJJ37FvLZZumGI — public result lists 23 songs, 48m 27s, release 2026-02-06.
- Zvuk album: https://zvuk.com/release/48662028 — public track listing.
- Qobuz album: https://www.qobuz.com/gb-en/album/-/pqhp8kakd95jd
- Amazon Music album: https://music.amazon.in/albums/B0GLWJ7991
- YouTube album mix: https://www.youtube.com/watch?v=8TSgrYNinss
- YouTube Topic track: https://www.youtube.com/watch?v=AhcyhUscX2M (практически ветер).
- Public artist discovery pages: https://volt.fm/artist/186407389/molodoj-rubl and https://soundcloud.com/discover/sets/track-stations%3A2261159534

Minimum named-track assertions:
1. ботаника флоу
2. роллин
3. сделал это
4. фантастическая материя
5. рублькэш
6. амахасла
7. курс
8. практически ветер
9. прямо на пол
10. стиснув зубы

The release has 23 songs. Use the Spotify/Zvuk/Qobuz/Amazon listings and YouTube release description to reconcile the complete 23-track tracklist, aliases/transliterations and featured artists; do not treat the ten named assertions as the complete album.

Test procedure:
- Search the artist separately on each provider adapter (Audius, Jamendo, Spotify metadata, SoundCloud approved API, Apple/TIDAL if enabled, YouTube Data API).
- Search every track title both with and without artist name; include Cyrillic and transliteration variants.
- Fetch artist page and album page where provider permits; paginate until the provider reports completion. Compare found count and titles to the reference tracklist.
- Store a per-provider result matrix: artist match, album match, each track match, provider ID, canonical URL, availability state, stream/playback type, rights/license, API response status and checked timestamp.
- Distinguish metadata_only, external_link, official_embed, preview, playable, needs_auth, region_restricted, not_found, and rights_unverified. Do not mark a catalog search hit playable without testing its permitted playback path.
- Audius and Jamendo are current active adapters. A track missing from them is not a failure of Spotify/YouTube availability; report coverage by provider.
- Never scrape protected Spotify/SoundCloud audio or extract streams. Use official APIs, official embeds, provider links and user-authorized handoff only.
- This test is now active and must not be deferred again unless the user asks.



## Young Ruble catalog verification — 2026-11-19 (read-only browser research)

The public-web research run completed. It checked Apple Music, Deezer, YouTube Music, Spotify, SoundCloud, Audius, Jamendo and Bandcamp. Findings below describe public catalog evidence only; they do not establish that SONORA's deployed adapters can find or play these tracks.

### Confirmed release and track links
- Apple Music album: https://music.apple.com/ru/album/шкёрт/1873987298 — 23 songs, 48 minutes, 6 February 2026; individual song pages and preview controls were visible.
- Deezer album: https://www.deezer.com/ru/album/912934511 — 23 linked tracks; artist ID 352615202.
- YouTube Music album: https://music.youtube.com/playlist?list=OLAK5uy_mHcHcPnBuV2Ex0gAbh4yy6w_YhYj0nE4I — 23 songs with individual video links and public play counts.
- Spotify album: https://open.spotify.com/album/2jek5OrDxJJ37FvLZZumGI and artist https://open.spotify.com/artist/6miZ3wXHS6I4IXLONIQpWs — IDs confirmed; public player only rendered a JS shell during this read-only check. Track «курс» was independently verified.
- SoundCloud artist profile: https://soundcloud.com/dblvnt-586464205 — profile found, but no official album page confirmed; third-party reposts are not proof of official catalog availability.
- No matching public result found in this browser pass on Audius, Jamendo or Bandcamp. This is a bounded public-web observation, not proof that no private/unindexed catalog entry exists.

All ten required test tracks were individually matched on Apple Music, Deezer and YouTube Music:
1. «рублькэш» — Apple https://music.apple.com/ru/song/рублькэш/1873987575 ; Deezer https://www.deezer.com/ru/track/3827203501 ; YouTube Music https://music.youtube.com/watch?v=kCVhk6-B2-0
2. «ботаника флоу» — Apple https://music.apple.com/ru/song/ботаника-флоу/1873987299 ; Deezer https://www.deezer.com/ru/track/3827203461 ; YouTube Music https://music.youtube.com/watch?v=6U0tWQgZz84
3. «роллин» — Apple https://music.apple.com/ru/song/роллин/1873987300 ; Deezer https://www.deezer.com/ru/track/3827203471 ; YouTube Music https://music.youtube.com/watch?v=faIJw0eXEuY
4. «сделал это» — Apple https://music.apple.com/ru/song/сделал-это/1873987302 ; Deezer https://www.deezer.com/ru/track/3827203481 ; YouTube Music https://music.youtube.com/watch?v=o--hoQFPxFQ
5. «фантастическая материя» — Apple https://music.apple.com/ru/song/фантастическая-материя/1873987573 ; Deezer https://www.deezer.com/ru/track/3827203491 ; YouTube Music https://music.youtube.com/watch?v=I9LfeMznGqU
6. «амахасла» — Apple https://music.apple.com/ru/song/амахасла/1873987576 ; Deezer https://www.deezer.com/ru/track/3827203511 ; YouTube Music https://music.youtube.com/watch?v=z1RzOJr7hY0
7. «курс» — Apple https://music.apple.com/ru/song/курс/1873987577 ; Deezer https://www.deezer.com/ru/track/3827203531 ; YouTube Music https://music.youtube.com/watch?v=YUXoGq0tg1U
8. «практически ветер» — Apple https://music.apple.com/ru/song/практически-ветер/1873987579 ; Deezer https://www.deezer.com/ru/track/3827203541 ; YouTube Music https://music.youtube.com/watch?v=AhcyhUscX2M
9. «прямо на пол» — Apple https://music.apple.com/ru/song/прямо-на-пол/1873987582 ; Deezer https://www.deezer.com/ru/track/3827203551 ; YouTube Music https://music.youtube.com/watch?v=K52Ih-ZYask
10. «стиснув зубы» — Apple https://music.apple.com/ru/song/стиснув-зубы/1873987594 ; Deezer https://www.deezer.com/ru/track/3827203641 ; YouTube Music https://music.youtube.com/watch?v=v5eBG6rqxtY

### Result classification
- Apple Music: album + all ten track identities confirmed; previews visible. Full playback was not started. Classify as preview/catalog evidence, not SONORA-playable.
- Deezer: album + all ten track identities confirmed. Full playback was not started. Classify as catalog/external provider result pending approved API/player entitlement verification.
- YouTube Music: album + all ten video identities confirmed. Full playback was not started. Use official video links/player only; do not extract audio.
- Spotify: artist/album IDs and one track verified, but public page rendering was incomplete. Keep metadata status partial pending official API access.
- SoundCloud: artist profile found; official album/track coverage unconfirmed.
- Audius, Jamendo, Bandcamp: no matching public result in this browser pass; confirm through official API and SONORA's own search before final not_found state.

### Implementation consequence
Add Apple Music and Deezer as high-priority metadata/catalog adapters, subject to official API credentials, scopes, current territory rules and developer terms. Add YouTube as a video-result adapter using official APIs/player, never as extracted audio. Keep provider capabilities separate: catalog match, preview, official embed, external handoff, full playback and download are independent states. Do not add these sources to SONORA's unified native audio queue until a permitted playback path is documented and tested. This research did not access SONORA's production UI or deployed API, and did not test full playback.

## Actual audio acquisition and playback architecture — 2026-11-19

The user clarified the core product requirement: SONORA must obtain a playable audio source for its own player where the provider explicitly authorizes that use; merely showing another platform's title, artwork or outbound URL is not sufficient. This is a product requirement, not permission to copy protected audio or bypass provider controls.

### LANE investigation: confirmed public model, unknown private implementation
- LANE's current public terms (updated 2026-07-17): https://sklane.com/ru/terms-of-service
- Sections 2.1–2.3 describe LANE as a software player/personal media-library manager, not a streaming service; it says it does not provide access to third-party audio files and does not store music. Spotify and SoundCloud APIs are used for search and metadata (title, artist, artwork and other track data). Sections 3.1–3.2 repeat that these APIs are used exclusively for search and song information, and that LANE does not transmit, store or distribute their audio.
- Public evidence does NOT support the theory that LANE extracts Spotify/SoundCloud audio and imports it into its own server-side music catalog. Its stated model is metadata discovery + management/interoperation with supported services and a user's personal media library. Public terms do not disclose enough implementation detail to assert exactly which local files, OS media APIs, provider SDKs or external player handoffs are used for each playback path. Keep this distinction explicit; do not invent undocumented LANE internals.
- Spotify Web API can search catalog, retrieve metadata, manage libraries/playlists and control a user's Spotify playback; it does not expose a general-purpose downloadable MP3 source for SONORA. Official docs: https://developer.spotify.com/documentation/web-api and https://developer.spotify.com/documentation/web-api/reference/search. Spotify's official Web Playback SDK creates a Spotify Connect browser player, not a reusable audio file URL: https://developer.spotify.com/documentation/web-playback-sdk. Spotify streaming is Premium-only under its policy, and its restrictions on cross-service stream/content integration require special care for a multi-provider app: https://developer.spotify.com/policy.
- SoundCloud's official API is materially different: its current guide documents search, track resource lookup and stream_url/transcoding resolution for tracks marked playable; tracks may instead be preview or blocked. Public tracks can be streamed without a user session where API access is granted; private tracks require user OAuth and authorized access. Custom players must provide creator/source attribution and a link to the SoundCloud track. Official docs: https://developers.soundcloud.com/docs and https://developers.soundcloud.com/docs/api/.
- SoundCloud also restricts persistent caching/download/offline storage of user content and limits commercial embedding/redistribution. Read the current API terms before implementation: https://developers.soundcloud.com/docs/api/terms-of-use. This makes it unsuitable as a source to copy audio into SONORA storage; if approved access is granted, the only candidate is a compliant live provider stream in-session with required attribution and revocation handling.
- Do NOT adopt repositories/tools that scrape internal Spotify/Deezer/SoundCloud endpoints, extract web-client tokens/client IDs, use yt-dlp to obtain protected music, or produce MP3s from protected catalog pages. Example public project describing such methods: https://github.com/amiralibg/unstream. It is explicitly not an integration reference for SONORA because its methods include internal/private endpoint and stream-resolution workarounds. Do not implement those methods.

### Required distinction: four ways a track can enter SONORA
1. **Licensed native stream:** provider has granted SONORA explicit API/SDK permission to play a track in our own player. Backend resolves short-lived stream/transcoding URL on demand; client plays it through web audio/Media3. Never persist expiring URLs or source audio. Respect territory, account entitlement, attribution, creator restrictions, and revoke/blocked status.
2. **Official provider player/SDK:** user plays through the provider's official player/SDK in its permitted context. SONORA can own the queue/metadata UI only to the extent the provider SDK permits; it must not extract or proxy the audio bytes.
3. **User-owned audio:** user imports a local file or connects a personal server/library (e.g. Navidrome/Subsonic) that the user owns or is authorized to access. Playback is from that user's source; permissions and disconnect/delete controls are per user. No shared public catalog is implied.
4. **SONORA-licensed catalog:** SONORA obtains distribution/streaming rights directly from artists, labels or distributors, stores audio in object storage, and serves it through signed, short-lived URLs/CDN. This is the only straightforward way to make third-party licensed tracks truly first-class SONORA-hosted catalog items at scale.

Metadata-only discovery and provider links are NOT audio acquisition. Do not label a result as SONORA-playable unless one of the four paths above has been verified.

### Target architecture to implement
- CatalogSearchService: fan out artist/album/track queries to providers in parallel, bounded timeouts and provider-specific pagination; preserve provider IDs, ISRC, MusicBrainz IDs, title/artist/album/duration/territory, source URL and artwork attribution. Search Cyrillic, transliteration and normalized punctuation/diacritics; use exact artist+track matching and confidence scores to avoid the unrelated near matches seen in the Young Ruble test.
- TrackIdentityResolver: match exact ISRC first where legally returned, then MusicBrainz recording ID, then normalized title+artist+duration with a confidence score; never merge solely on a generic title. Preserve all provider variants as source records under one canonical SONORA track only when match confidence passes threshold.
- PlaybackCapabilityResolver: return native_stream, official_sdk, official_embed, preview, external_handoff, user_file, licensed_sonora_asset, or metadata_only. Include provider policy, region, user entitlement, current access state, license and expiry. The UI must say which player will actually play it.
- PlaybackSessionService: authorize current user, check provider and territory entitlement, resolve a fresh playable source on demand, issue short-lived session/playback tokens, avoid logging credentials or stream URLs, and record play/skip/progress only when allowed. Never proxy a provider stream unless the provider contract explicitly permits proxying.
- UserProviderConnections: OAuth PKCE where supported; encrypt tokens at rest; isolate tokens, libraries, favorites, and playback sessions per user; refresh/revoke safely; never share one account's provider credentials with another user.
- SONORAAssetService: for direct-licensed tracks and user-authorized uploads only, store object metadata and files separately, scan/validate media, transcode only where rights permit, use signed short-lived CDN/object URLs, support range requests, and implement deletion/takedown workflows.
- Web player: use the native SONORA player only for licensed native streams, user files, and SONORA-licensed assets. Use official SDK/embed contexts for other services; don't make an external provider's audio look like an internal source.
- Android: Media3 handles authorized native streams/user files/SONORA assets; official provider SDKs remain separate player surfaces if permitted. Persist provider track IDs and queue identity, not expiring stream URLs. Resolve again on queue restore.
- Observability: provider response code, search result count, matching score, capability state, entitlement/region denial, resolver failure reason and trace ID; never log access tokens or raw private URLs.

### Young Ruble test: actionable defect and acceptance criteria
Read-only production QA (19 Nov 2026 UTC) found:
- SONORA production search pages returned HTTP 200, but no exact «молодой рубль», «шкёрт» or any of the ten target track titles appeared in the latest snapshot. Search often returned unrelated near matches, showing weak exact-match ranking/filtering.
- Audius official REST queries returned HTTP 200. Ten exact track query counts: ботаника флоу 0, роллин 1, сделал это 2, фантастическая материя 0, рублькэш 0, амахасла 0, курс 6, практически ветер 0, прямо на пол 0, стиснув зубы 0. No exact requested title was identified in those results. Returned candidate tracks exposed access.stream: true and is_available: true, but those were unrelated tracks.
- Jamendo public artist search returned zero artists for «молодой рубль». Exact track «амахасла» DOES exist on Jamendo as https://www.jamendo.com/track/1448577/amakhasla (artist fantazero65); its public page returned HTTP 200 and exposed an audio/mpeg secure stream URL in page metadata. However SONORA's production search for «амахасла» did not surface it. This is a concrete adapter/search coverage defect to investigate; do not claim this is the same recording as Молодой Рубль's album track until audio/metadata/ISRC identity is verified.
- SONORA also returned many unrelated matches for short/generic queries such as «курс», «роллин», «прямо на пол» and «стиснув зубы». Add exact match ranking, artist-aware search, title token coverage and false-positive suppression.
- Detailed read-only report was produced at outputs/sonora-qa.html in the browser task. No login, form submission, audio playback or production change was performed.

### Build order for actual track acquisition
P0. Fix and test existing Jamendo adapter against the exact «амахасла» public result. Verify the Jamendo official API response with the project's client ID, audio, license_ccurl, audiodownload and audiodownload_allowed fields; distinguish stream permission from download permission; add a regression test proving the result appears and is playable only if allowed by the current license/API rules. Do not assume a page's HTML stream URL is a stable supported API contract.
P0. Audit Audius/Jamendo source resolver and player end-to-end: search → exact match → capability check → fresh stream resolution → web player → Android Media3 → notification/background → error/expiry refresh. Test a genuinely permitted track, not just the presence of a play button.
P1. Implement provider capability registry and session resolver described above, including per-user OAuth/entitlement isolation.
P1. Apply for official SoundCloud developer access and evaluate only the documented stream API for public playable tracks; no caching/download. Gate behind explicit commercial-use approval and attribution compliance.
P1. Spotify remains metadata + official player/handoff only unless written Spotify clearance authorizes the proposed multi-provider integration. Do not try to turn Spotify catalog IDs into audio file URLs.
P1. Research official Apple Music/MusicKit and TIDAL playback SDK paths; implement separately behind feature flags and verify subscriber entitlements, territories, device support and terms.
P2. YouTube remains official video/player result, not an audio source. Deezer/VK/Yandex require current official partner/API permission before playback work.
P2. Create SONORA's own licensed catalog ingestion flow (artist/label agreement, rights metadata, territory, ISRC, artwork, master audio, takedown contact, stream/download permissions) if the product requirement is to have tracks physically hosted/served by SONORA.
P2. Add user-owned local file and Subsonic/Navidrome connector as separate personal-library source, with no claim that these files are part of a public shared catalog.

### Release gates
- Unit/contract tests for provider search normalization, exact matching, pagination, license parsing and capability states.
- Integration tests for stream URL freshness/expiry, redirects, content type, range requests, provider access revocation and per-user isolation.
- Real web and Android playback tests with logs showing actual audio position advancing; a rendered card or enabled button is not proof of playback.
- Rights/legal review for each provider and any SONORA-hosted catalog.
- No production deployment, database migration application, PR merge, or use of production credentials without explicit user authorization.


### Additional LANE public product and release evidence (2026-11-19)
- Official LANE product page describes it as a personal media player for organizing a user's media library, playlists and playback; external services work only through supported integrations and their terms. It describes offline access as applying to authorized content and says availability depends on source, territory, license and provider terms: https://sklane.com/en and https://sklane.com/ru.
- LANE's public developer Telegram channel has release announcements mentioning “fixed Spotify streaming”, SoundCloud fixes, song downloads, playlist import and new streaming servers (for example the LANE 1.4 announcement): https://t.me/s/lane_devs. These are marketing/release claims, not a technical description of the transport or proof that third-party protected audio is lawfully relayed.
- There is a material public-documentation inconsistency: release notes mention Spotify streaming/download features, while the currently published LANE Terms say Spotify/SoundCloud APIs are used exclusively for search/metadata and that LANE does not store, transmit or distribute those services' audio. Until LANE's developers clarify which content source the player uses and what rights authorize it, do not infer an undocumented Spotify/SoundCloud audio extraction method. Treat official terms as the conservative integration boundary.
- Third-party forum reports describe Spotify playlist import by matching title/artist to tracks in another catalog (for example SoundCloud) rather than copying Spotify's original audio: https://4pda.to/forum/index.php?showtopic=1119053. This is an anecdotal report and not proof of LANE's internal code. The same cross-catalog matching pattern is a legitimate design for SONORA only when the replacement source has its own authorized playable stream and the match is confirmed, not merely a similar title.
- Practical SONORA lesson: playlist import from Spotify can import metadata/IDs, then independently search authorized SONORA sources (Audius, Jamendo, SoundCloud if approved, direct-licensed catalog, user library). Store each source candidate separately and show the actual provider/quality/rights. If no valid match exists, keep an unavailable placeholder rather than silently substituting an unrelated track. Spotify's official metadata must not be represented as the audio source.


### SONORA source-code audit after production QA (main branch snapshot)
Reviewed the current main-branch API search route and web player implementation:
- The API has a dedicated Jamendo catalog route at /api/v1/providers/jamendo/tracks supporting both free-text search and exact Jamendo ID lookup. It requests the official Jamendo API with client_id, include=licenses musicinfo, type=single albumtrack and audioformat=mp32.
- The unified /api/v1/search/music route separately calls Jamendo with search=q and filters out records unless the license URL is one of the recognized Creative Commons/Public Domain patterns and an audio URL is returned. It is currently gated on JAMENDO_CLIENT_ID and JAMENDO_USE_MODE=noncommercial. The separate catalog route can also allow commercial mode when JAMENDO_COMMERCIAL_APPROVED=true, but the unified search route does not share that condition. This is a possible configuration/feature inconsistency to investigate; do not assume it is the root cause of the missing Amakhasla result.
- The Jamendo filter deliberately allows known NC licenses only in the noncommercial mode; it does not use audiodownload_allowed as a prerequisite for streaming, which is correct because streaming permission and download permission are distinct. Download URL is returned only when audiodownload_allowed=true.
- Web player uses an HTML audio element and plays the returned audioUrl directly; it refuses a track with no audioUrl, records play/skip/complete events, and advances to a fallback candidate if a stream errors. This proves the code path exists, not that every provider stream works in production or that a particular test track is playable.
- The API code does not currently expose an explicit Jamendo rejection reason for a candidate filtered by unknown/non-accepted license or missing audio URL. Add safe provider diagnostics and tests so a missing exact track can be explained as query miss, no audio, unsupported license, disabled provider/config, or provider API failure.
- Important: this audit is of repository main snapshot; it does not prove that the running Railway deployment uses this exact commit. Verify deployed commit/config before attributing a live defect to one code line.

P0 Jamendo regression investigation should therefore test the exact Jamendo ID 1448577 through the deployed dedicated route and the official API, inspect license_ccurl and audio fields, compare free-text search versus ID lookup, and then add a regression test for the actual failure cause. Never copy the HTML secure stream URL as a workaround or persist it as a permanent source URL.


### LANE technical investigation — final public-browser findings (19 Nov 2026)
- No public FAQ, API specification, or documented playback/auth flow was found. The public API docs/OpenAPI routes returned a missing-signature-token response; no attempt was made to obtain or bypass that token.
- LANE's Privacy Policy describes its own account login via Telegram or Google and records listening history, likes, playlists and queue interactions. It does not explain Spotify/SoundCloud OAuth, user playback tokens or whether provider accounts are required: https://sklane.com/en/privacy-policy
- The public product page says LANE organizes a personal media library, manages playlists/playback and only connects external services through supported integrations and their terms. Premium says offline access to authorized content; the Premium terms mention offline caching. This supports a personal-library/authorized-content model but does not reveal where cached bytes are stored: https://sklane.com/en and https://sklane.com/ru/premium-terms
- Public developer posts advertise Spotify streaming fixes, SoundCloud fixes, song downloads and streaming optimization, but no public technical mechanism was exposed: https://t.me/s/lane_devs/112 and https://t.me/s/lane_devs/117. The discrepancy with the Terms remains unresolved. Do not claim to know LANE's private implementation.
- The official site links to a direct Android APK; its iPhone button is an anchor rather than a working App Store destination, and the checked Google Play package URL was not found. This does not affect our design, but means we cannot use an official store listing as technical evidence.
- LANE's public docs do not establish that Spotify/SoundCloud audio is extracted, hosted or proxied. The safe conclusion is: metadata import/search is documented; exact audio resolution/playback mechanism is not publicly verifiable.

### Final LANE-inspired import flow for SONORA
1. User pastes a Spotify/SoundCloud/Apple/YouTube/Yandex playlist or album URL, or selects an official provider connection.
2. Import only the source playlist structure and permitted metadata/IDs via official API, SDK or public share page within provider rules.
3. Normalize each source item and keep the original provider ID and source URL.
4. Search SONORA's authorized playback catalogs independently (Audius, Jamendo, approved SoundCloud, licensed SONORA catalog and the user's own library).
5. Resolve exact recording using ISRC, MusicBrainz ID, duration and title/artist confidence; reject wrong versions, live/covers/remixes unless explicitly selected.
6. If a valid permitted playable source is found, attach it as a separate provider-source mapping and play that source. If no source is found, keep the imported playlist row with a clear unavailable status and allow the user to choose another match.
7. Do not tell the user the Spotify track itself is playing when SONORA is actually playing a SoundCloud/Jamendo/other source match. Show actual source provider, quality/format where available, and rights/availability state.
8. Per-user: imported playlist, source mappings, likes, history, queue and connected provider tokens are scoped to that SONORA user. OAuth tokens are encrypted and never shared; disconnect revokes/deletes user connection state as required. For playback from a provider, the source's own entitlement and session rules apply independently.


### Existing SONORA playlist-import audit (main branch snapshot)
- The current web import page accepts CSV/plain-text lists. Its source selector (Spotify, Apple Music, YouTube Music, SoundCloud, Yandex, VK, Telegram, Other/CSV) is informational only; it does not authenticate to or query the selected platform.
- Matching currently calls Jamendo in batches of five, capped at 100 rows. It asks the user to choose candidates, then saves selected matches through provider-favorites. It does not currently import a provider playlist URL, recreate playlist structure/order, or save imported matches directly as a new SONORA playlist.
- Album metadata is parsed but currently unused for disambiguation. There is no documented Spotify OAuth/playlist API connection in this import flow.
- Therefore do not describe current SONORA as having live Spotify/SoundCloud/Yandex playlist import. The UI currently supports matching exported metadata lists against Jamendo, with the source dropdown acting as a label.
- Required implementation: provider-specific official playlist readers behind connection adapters; retain source playlist name/order/IDs; cross-catalog match each row against actual authorized streams; preview matched/unmatched/ambiguous rows; require user confirmation; create a SONORA playlist preserving order and provider source mapping. Do not silently write to favorites or substitute weak title matches.
