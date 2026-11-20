# SONORA agent handoff

Updated: 2026-11-18

This document is the shared context packet for any coding, QA, research, or Android agent working on SONORA. Read it before touching the repository. SONORA is the only project in scope.

## Project identity and boundaries

- Repository: https://github.com/derector/SONORA
- Owner: `derector`
- Main web/API branch: `main`
- Native Android branch: `android-native`
- Product: an independent-music discovery and listening platform with web and native Android clients.
- Do not create a parallel/duplicate SONORA repository or a second production backend.
- Do not mix this work with NEXUS or Lyric Motion Studio.
- Do not use Termux or Expo EAS.
- The user works primarily from Android and wants a real installable APK, not a web preview.

## Non-negotiable product and operating constraints

1. Keep the service free to operate where possible; target €0/month. Do not add paid APIs, paid plans, or subscriptions without explicit approval.
2. Use official provider APIs and respect their terms. No scraping, private endpoints, stolen cookies/tokens, client impersonation, or bypassing playback restrictions.
3. Catalog metadata, playback availability, download permission, and commercial rights are separate facts. Never label a track licensed/playable unless the source response and applicable rights checks support it.
4. Keep provider secrets and database credentials server-side. Never print secrets into logs, commits, browser bundles, or this document.
5. Preserve existing branches and working features. Do not delete data, tables, branches, or services.
6. Do not claim registration, playback, offline mode, APK signing, or deployment is working until the exact flow has been tested.
7. Do not run `npm audit fix --force` or broad dependency upgrades without reviewing the specific advisories and compatibility first.

## Current infrastructure

### Production services

- Web: https://sonora-web-production-fb072d10.up.railway.app/
- API: https://sonora-web-api-production.up.railway.app/
- Railway project: `SONORA`, production environment.
- Railway web service: `SONORA Web`.
- Railway API service: `SONORA Web + API`.
- API health endpoint: `GET /health`, last checked healthy.
- API route manifest: `GET /api/v1`.
- Supabase project: `SONORA`, project ID `qmnpszgbbuzfymezlcpb`, region `eu-central-1`, Free plan.
- Supabase is the PostgreSQL/Auth backend. Never copy credentials from Railway or Supabase into Git.

### Recent web commits and deployment state

- `2bf72fb9fd2c6b78d7c4b5fe19fcedad52b564e4`: replaced the old static homepage mixes with a live playable catalog sourced from Audius/Jamendo. Build and deployment succeeded.
- `3d74c7a6fac566b5fb6679e9d1e3f47e44dcd14e`: homepage now requests Jamendo with `q=music`, because the live endpoint returns no items when queried without a search term. Railway deployment `aba37d2b-5635-46af-a878-dd499274ff70` reached SUCCESS.
- `2cc2dc27bed2488970790d062575b11253d0af07`: Discover's default Jamendo request now also supplies `q=music`. Deployment succeeded. A browser QA agent verified 24+ Jamendo tracks and player state changes on Play.
- `077b197a96ff9cf8cfc53e591ac78eaf3d212275`: homepage now interleaves Audius and Jamendo tracks before applying its 12-card cap, instead of filling the first 8 positions with Audius. Deployment status must be checked before claiming this newest commit is live.

The web build reported 12 npm audit advisories (1 moderate, 11 high). This remains an open security-maintenance task. Inspect advisory details before changing versions.

## Implemented functionality (verify before extending)

### Web

- Next.js App Router + TypeScript + Tailwind.
- Homepage with live provider catalog cards and shared player integration.
- Discover page with Jamendo/Audius source switching.
- Federated music search endpoint/page.
- Email OTP registration and login UI.
- Profile details and avatar upload UI.
- Playlists, provider favorites, listening history and settings pages.
- Shared auth and player React providers.

### API

- Node.js + TypeScript + Fastify.
- Supabase Auth email OTP endpoints:
  - `POST /api/v1/auth/register`
  - `POST /api/v1/auth/login`
  - `POST /api/v1/auth/verify`
  - `POST /api/v1/auth/refresh`
  - `GET /api/v1/auth/me`
  - `POST /api/v1/auth/logout`
- Refresh token is stored in a secure HttpOnly cookie named `sonora_refresh`; browser requests must use credentials.
- Profile endpoints include `GET/PATCH /api/v1/profile` and `POST /api/v1/profile/avatar`.
- Playlist, favorite, history, catalog and provider routes exist.
- Email delivery and complete sign-up/login/session restoration have NOT yet been independently verified end-to-end with a real user inbox in this work session.

### Music providers

- Audius: live endpoint returns real track metadata and stream URLs. Example:
  `GET /api/v1/providers/audius/tracks?sort=trending&limit=5`.
- Jamendo: live endpoint returns real track metadata and audio URLs when a search term is supplied. Example:
  `GET /api/v1/providers/jamendo/tracks?q=music&limit=5`.
- Jamendo without `q` currently returns `sourceCount: 0`; the homepage and Discover defaults have been patched to use `q=music`.
- Jamendo API use is configured for non-commercial mode. The official developer page states a 35,000-request monthly allowance for non-commercial apps. This is not blanket commercial streaming permission; track-level CC license conditions still apply.
- MusicBrainz is metadata-only. Never represent its recordings as playable.
- VK Music is not connected. VK ID login does not grant rights to stream VK Music. Do not use undocumented/private VK endpoints.
- Free Music Archive is NOT an acceptable quick integration: its official developer page says its API was shut down, direct hotlinking is prohibited, and user-search forwarding/scraping is not allowed without approval.
- Internet Archive is only a research candidate. Verify the license and rights of each item before any playback integration.

## Native Android

- Branch: `android-native`.
- Native Android source lives under `apps/android`.
- GitHub Actions Android workflow #35 succeeded for Android commit `758a9c9b4c601cd66ad0281dd7bfdaa60df3e261` (run ID `44202958970`). It includes the Jamendo `q=music` fix in `SonoraApi.kt` and produced artifact `14382142101`.
- The APK was downloaded and verified as a 22,752,675-byte APK file. SHA-256: `e9dbfdb49a10a0ae920c7985e1b8df38fb084faafc529debd966dc1b1bfc43cd`.
- This is a debug build, not a release APK signed with a persistent production keystore.
- It is a debug build, not a release APK signed with a persistent production keystore. Do not claim safe in-place updates until applicationId and a stable signing key are configured and verified.
- Continue using GitHub Actions/Gradle for APK builds. Do not switch to Expo EAS.
- Android 8+ compatibility is an intended requirement; verify minSdk and runtime behavior from the current Android branch before claiming it.

## Work still required, ordered by priority

1. Verify deployment of latest homepage balancing commit `077b197a96ff9cf8cfc53e591ac78eaf3d212275`; then browser-test provider balance and playback.
2. Test real email OTP delivery, code verification, profile creation, cookie refresh, page navigation and session persistence after reload. Do not call auth complete until all pass.
3. Test real playback in browser: play/pause, queue progression, source links, audio errors and mobile browser behavior. Verify that each provider's returned audio URL remains playable.
4. Audit profile/favorites/playlists flows for session races and ownership checks. Test create, add, remove, reload and sign-out.
5. Browser QA (2026-11-18): Discover default Jamendo shows 24+ cards; pressing Play changes the shared player to playing state. Homepage currently renders 8 Audius + 4 Jamendo cards because the 12-card cap previously sliced an Audius-first concatenated list; commit `077b197` interleaves sources to balance the feed. Re-test after deployment.
6. Review npm advisories individually and patch safely.
7. Audit the native Android branch: API base URL, auth, player, background playback, notifications, offline download permissions/storage, Android 8 compatibility, update/versioning and stable signing.
8. Produce a new APK only from the current Android branch after the above Android checks; distinguish debug/release and build/signature/runtime verification.
9. Research any additional provider only after official API, rights, attribution, stream delivery, quotas and free-tier terms are confirmed.

## Agent task protocol

Each delegated agent must receive:
- This handoff document and the exact branch/commit it should inspect.
- One independent scope (for example: auth QA, Android audit, provider research, or security advisory review).
- A clear list of what is already implemented and what remains unverified.
- Explicit boundaries: no secrets, no production configuration changes, no destructive database actions, no unrelated project changes.
- Expected output: evidence, exact files/endpoints checked, test results, risks, and a concise list of recommended changes.

Agents should work on isolated branches or return findings only. Do not let multiple agents edit the same files concurrently. Review all agent changes and run the relevant build/tests before merging or deploying.
