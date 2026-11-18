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
