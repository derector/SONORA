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

