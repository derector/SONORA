# SONORA production QA findings (2026-11-19)

Production QA was performed against the live web app. One existing-account sign-in was completed with the owner-authorized test mailbox. No account was registered, and no profile, avatar, or settings data was changed.

## Routes

- `/auth` is the registration and sign-in entry point. The page has separate `Create account` and `Sign in` modes.
- `/profile` redirects to `/auth` when the client does not have a restored authenticated session.
- `/settings` is publicly viewable; its profile link points to `/profile`.
- `/register` and `/signup` previously returned 404. This PR adds redirects to `/auth` for both legacy paths.
- Home, Search, Discover, Playlists, Favorites, History and Import routes loaded during the initial review.

## Live search observations

- `молодой рубль`: no exact track result; Audius returned unrelated artist-name matches.
- `Кишлак`: one playable Audius remix by another uploader and MusicBrainz metadata matches, not a verified official catalog.
- `БРЕДИШЬ`: no matches in the visible providers; MusicBrainz reported unavailable in that request.

The SoundCloud priority-artist work in PRs #42 and #43 is separate and not merged. It uses provider-hosted embeds for a curated seed list, not a general provider search integration. Nine canonical SoundCloud pages and nine official widgets were subsequently confirmed publicly available; audio playback itself was not started during that URL check.

## Existing-account sign-in test

- Selected **Sign in**, not **Create account**.
- Submitted the owner-authorized mailbox `staf767667staff@gmail.com` to the login endpoint.
- A fresh eight-digit email code was received and accepted by the live site.
- The site briefly opened the authenticated home workspace and displayed the account identity `DANIIL`.
- Navigating to `/profile` redirected to `/auth`; reloading the homepage showed the signed-out state. Persistent login is therefore **not verified**.
- A subsequent read-only browser diagnostic found no `sonora_refresh` cookie in the API host cookie jar. The next `POST /api/v1/auth/refresh` sent no Cookie header and returned HTTP 401 with `A valid refresh token is required.`
- The refresh request included credentialed CORS response headers (`Access-Control-Allow-Credentials: true`, `Vary: Origin`, and an allowed origin). The verify response's original `Set-Cookie` header was not retained in browser Network history, so the precise cookie rejection/set failure is not yet proven.
- Source review confirms the API verify handler calls `reply.setCookie("sonora_refresh", ...)` with `HttpOnly`, production `Secure`, `SameSite=Lax`, and `Path=/api/v1/auth`. The web client calls refresh with `credentials: "include"`.
- The evidence narrows the defect to the refresh-cookie handoff/persistence path, but does not yet identify whether the cookie was omitted by the verify response, rejected by the browser, or scoped incorrectly. Capture the verify response's Set-Cookie header and browser blocked-cookie diagnostics on the next controlled sign-in before changing cookie policy.

## Auth/profile verification still required

- Confirm the verify response actually includes the expected Set-Cookie header and record browser acceptance/rejection details without exposing the token.
- Confirm session restoration after reload and in a fresh browser context.
- Confirm duplicate-email and duplicate-username handling.
- Confirm profile name/username updates, username conflict handling, avatar upload (JPG/PNG/WebP, <=2 MB), avatar persistence and image replacement.
- Verify avatar storage bucket policies, object ownership and cache invalidation.
- Test logout and confirm refresh cookie invalidation.
- Verify Android app login and session persistence separately; web success does not prove APK behavior.

No registration was performed. No profile, avatar, or settings changes were made. No production deployment or source merge was performed by this QA work.


## Proposed remediation in `fix/auth-first-party-session-proxy`

- Added a same-origin Next.js POST proxy at `/api/auth/[action]` for register, login, verify, refresh and logout.
- The proxy forwards only the `sonora_refresh` cookie to the API and forwards the logout Authorization header when present.
- The API's host-only HttpOnly cookie is re-scoped to the SONORA web origin at `Path=/api/auth`; HttpOnly, Secure, SameSite and expiry attributes are retained.
- Web sign-in, verification, refresh and logout now use the same-origin proxy. Profile and avatar data requests continue to use the API directly with the in-memory access token.
- The sign-in mode is now selected by default on `/auth`; account creation remains available through the separate Create account tab.

This is a code-level remediation proposal, not yet a verified production fix. It requires CI, deployment to a non-production test environment, a fresh email sign-in, cookie acceptance inspection, reload and fresh-context session tests. Do not merge or deploy until those checks pass.
