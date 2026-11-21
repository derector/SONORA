# SONORA Identity, Sessions & Profile Plan

**Status:** research and implementation plan  
**Date:** 2026-11-19  
**Scope:** SONORA web application, native Android application, API and database  
**Release rule:** draft changes only until CI, staging QA and explicit release approval. No production deployment or database migration is authorized by this plan.

## 1. Executive summary

SONORA should provide one account identity across web and Android, while maintaining a separate, revocable session for every browser or device. Users must be able to choose **Sign in** or **Create account** explicitly, remain signed in after normal app/browser restarts, inspect active sessions, revoke one device or all other devices, and manage their profile without losing their music library.

The current email OTP approach is a suitable low-friction starting point, but the surrounding session lifecycle and profile-security controls need to mature. The target is not to copy another service's UI pixel-for-pixel. It is to adopt proven user-facing capabilities and security controls from Google, GitHub, Apple, Spotify and OWASP.

## 2. Reference-product benchmark

The following are documented product behaviors, not claims about private implementation details.

| Reference | Observed pattern | SONORA adaptation |
|---|---|---|
| Google Account | A security page lists device sessions, distinguishes signed-in from signed-out entries, shows session details and lets the user sign out individual sessions. Multiple sessions may exist for one physical device. | Build a **Your devices / Active sessions** page. Model sessions separately from devices; show last activity and revoke individual sessions. |
| GitHub | Settings separates web sessions and mobile sessions, offers more details for a web session and allows individual revocation. Revoking a mobile session signs that app out. | Show browser and Android sessions in one list, with platform-specific labels and a clear revoke action. |
| Apple Account | A central device list includes devices across platforms and lets the owner remotely remove a device from the account. | Provide a unified device inventory across Android and web, not a web-only session screen. |
| Spotify | Account security guidance includes **Sign out everywhere** and separately removing third-party app access; partner devices may require separate removal. | Provide **Sign out of all other sessions** and a separate **Connected apps** list if SONORA later supports OAuth integrations. Explain that revoking SONORA sessions does not revoke external provider accounts. |
| OWASP | Use unpredictable session identifiers, protect browser cookies, rotate sessions/tokens, reauthenticate for sensitive changes, limit and monitor OTP attempts, and treat recovery as part of the authentication system. | Make session security, OTP controls, recovery and reauthentication backend-enforced requirements, not just UI features. |

### Reference links

- Google: https://support.google.com/accounts/answer/3067630
- GitHub: https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/viewing-and-managing-your-sessions
- Apple: https://support.apple.com/en-gb/102649
- Spotify: https://support.spotify.com/us/article/protect-your-account/
- OWASP Authentication: https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html
- OWASP Session Management: https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html
- OWASP MFA and OTP: https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html
- OWASP Passkeys: https://cheatsheetseries.owasp.org/cheatsheets/Passkey_Security_Cheat_Sheet.html

## 3. Current SONORA baseline and verified gaps

### Web/API source review

- API authentication currently exposes separate `/api/v1/auth/register` and `/api/v1/auth/login` endpoints. Both send email OTP through Supabase Auth; registration requests `shouldCreateUser: true`, while login uses `shouldCreateUser: false`.
- OTP verification expects an eight-digit email code, returns an access token and user profile, and sets a refresh-token cookie named `sonora_refresh`.
- The refresh cookie is currently HttpOnly, Secure in production, SameSite=Lax, scoped to `/api/v1/auth`, and has a configured max age. The API rotates the refresh token returned by Supabase when refreshing.
- The web auth provider keeps the access token in memory, requests refresh with credentials included, restores the user profile, and exposes profile update, avatar upload and logout functions.
- The web client currently calls the API on a separate origin directly for refresh. A prior production login test authenticated briefly but lost the session after navigation/reload; the API refresh request had no refresh cookie and returned 401. The precise browser cookie rejection cause was not captured.
- Draft PR #45 proposes a same-origin Next.js auth proxy to re-scope the HttpOnly cookie for the web origin. Typecheck and production build passed, but this remediation is **not yet proven** in a deployed staging browser.
- Web avatar client validation currently accepts JPG/PNG/WebP up to 2 MB. Server-side file-content validation, image decoding/re-encoding and full negative-case QA still need explicit verification.

### Android source review

- Native Android is Kotlin + Jetpack Compose + Media3, with Android 8 as the minimum target.
- Android sign-in/registration UI now has explicit **Войти** and **Создать аккаунт** modes, with login selected by default. Registration-only username and display-name fields are hidden in login mode.
- Android stores its access token, refresh cookie and email in AndroidX EncryptedSharedPreferences backed by Android Keystore. It captures the refresh cookie from the API response and sends it to the refresh endpoint on app restoration.
- The Android session implementation currently falls back to validating the access token if refresh fails, and clears local credentials if that validation fails. This path needs tests for transient network failures, expired access tokens, refresh-token rotation and revoked sessions.
- There is not yet a verified, user-facing cross-device session inventory or per-device revocation flow in the native app.
- APK workflow run #44501302507 completed successfully and uploaded artifact **SONORA-Android-debug**. This proves that a debug APK was built and uploaded; it does not prove installation, signing/release readiness, or live authentication on a physical phone.

### Current limitations to close

1. Web persistent login is not yet verified after the first-party cookie proxy change.
2. No unified server-side SONORA session/device inventory is exposed to users.
3. No individual session revocation UI or reliable global sign-out acceptance test is complete.
4. Android secure local storage exists, but refresh/revocation lifecycle needs hardening and physical-device QA.
5. Profile editing and avatar endpoints exist in the web source, but complete persistence, ownership, file validation and mobile parity are not verified.
6. Email change, recovery flows, security notifications, passkeys and account activity history are not yet established as complete features.

## 4. Target authentication experience

### 4.1 Entry and account discovery

- The first choice must be explicit: **Войти** or **Создать аккаунт**. Default to **Войти** when opening the auth route, because an existing user should not be pushed into registration.
- Sign-in must never silently create a new account. Registration must never silently overwrite or attach to an existing identity.
- Login: email → send code → verify code → restore profile and session.
- Registration: email + username + display name → send code → verify code → create the profile exactly once.
- Normalize email consistently; normalize username for uniqueness while preserving display casing where appropriate.
- Use neutral server responses where necessary to avoid leaking whether an email is registered. Keep the UI understandable without exposing account-enumeration details.
- OTP UI: eight-digit paste/autofill support, clear expiry/resend timer, edit-email action, invalid/expired-code state, loading state and accessible error messages.
- Never expose OTP values in logs, analytics, URLs, crash reports or chat output.

### 4.2 OTP protection and recovery

- Generate codes using the identity provider's secure OTP implementation.
- Require short expiry, one-time use, strict per-email and per-IP request/verification limits, resend throttling and invalidation of older codes after resend.
- Store/handle OTPs as authentication secrets; do not log them or persist them in plaintext application tables.
- Add abuse monitoring for repeated send/verify failures and suspicious recovery attempts.
- Recovery must not become a weaker route that bypasses stronger factors. Document how users recover access if they lose their mailbox or all trusted devices.

### 4.3 Session lifecycle

Use short-lived access tokens and rotating refresh credentials. The server is authoritative for session validity.

**Web target**
- Use the same-origin Next.js auth proxy for login/verify/refresh/logout, subject to successful staging verification.
- Keep access tokens in memory; do not store them in localStorage, sessionStorage, URLs or analytics.
- Keep refresh credentials in Secure + HttpOnly + SameSite cookies, scoped to the narrowest first-party auth path.
- Enforce exact allowed origins, credentials CORS policy and CSRF protection for state-changing requests. SameSite is defense-in-depth, not a replacement for origin/CSRF checks.
- Refresh atomically; handle concurrent tabs without invalidating a legitimate active session. Do not clear a valid session on transient network errors.
- On definitive refresh rejection, clear local auth state and cookie and return the user to sign-in with a clear explanation.

**Native Android target**
- Keep access tokens in memory where practical.
- Store only the refresh credential in encrypted storage backed by Android Keystore; do not put credentials in ordinary preferences, logs, backups or exported files.
- Rotate and persist the new refresh credential after every successful refresh. Handle app process death, device reboot, offline startup and refresh failure.
- Never share browser cookies or tokens with an embedded WebView. Use a separate native session identity.
- Provide a clear local sign-out even when the network is unavailable, then revoke server-side credentials when possible.

**Backend target**
- Define an application-level session/device record independent of the UI.
- Investigate Supabase Auth's supported session listing, refresh rotation and per-session/global revocation capabilities before choosing the final storage model. Do not assume that a client-side cookie alone gives SONORA a manageable device inventory.
- If an app-owned session registry is needed, store a random opaque session identifier, user ID, provider auth session reference, token-family identifier or safe token fingerprint, device metadata, created/last-seen/expiry timestamps, and revocation status. Never store raw refresh tokens in the registry.
- Use atomic refresh rotation and detect reuse of an already-rotated refresh token; revoke the affected token family and require sign-in again when reuse is confirmed.
- Revoke sessions server-side on logout, password/credential recovery, account compromise and explicit device removal.
- Keep device metadata privacy-minimized. Do not rely on IP address or fingerprint as authentication; treat them as risk signals only.

### 4.4 Active devices and sessions

Create one consistent screen in web and Android: **Настройки → Безопасность → Активные устройства**.

Each session entry should show:
- Device/app type: SONORA Android, browser name where reliably available, operating system family.
- User-chosen device label where possible; otherwise a neutral generated label.
- First sign-in date and last active time.
- Approximate location only if available and privacy-appropriate; label it as approximate.
- Current device indicator.
- Session state: active, expired or revoked.
- **Выйти с устройства** action for each other session.

Global actions:
- **Выйти на всех остальных устройствах**: revoke every other session but keep the current one.
- **Выйти везде**: revoke all sessions, including the current one, then clear local state.
- Confirm destructive global actions and explain that other devices may need to sign in again.
- Send a security notification after a new-device sign-in, session revocation, email change, passkey enrollment/removal or account recovery.
- Keep a small recent security-activity feed: sign-in, sign-out, OTP challenge, profile/email change, avatar change, session revocation and recovery events. Never record secrets.

### 4.5 Profile and account settings

Create a unified profile editor across web and Android:
- Avatar, display name, username, verified email and account creation date.
- Username availability check, case-insensitive uniqueness, allowed-character rules and clear validation errors.
- Display-name edits should not change the account's immutable user ID or detach playlists/favorites/history.
- Email change requires a fresh authentication step and verification of the new address. Notify the old address and do not switch the primary email until the new address is verified.
- Sensitive changes (email, recovery method, passkey, password if added, account deletion, connected identity) require recent reauthentication.
- Avatar upload: server validates actual file bytes and decodes the image, not just the client MIME header; enforce size and dimensions, allow only supported image formats, re-encode to a safe format, strip unnecessary metadata, use owner-scoped storage paths and update cache/version keys after replacement.
- Keep avatar upload and profile update atomic from the user's perspective; if storage fails, preserve the previous avatar.
- Provide profile-data export and account deletion flows with clear confirmation, retention explanation and deletion of associated user data subject to legal/security retention requirements.

### 4.6 Passkeys and stronger sign-in

- Add WebAuthn/passkeys as a later opt-in sign-in method after email OTP, session management and recovery are stable.
- Allow multiple passkeys per account and display friendly labels, created/last-used dates, and remove/revoke controls.
- Require recent authentication before adding/removing a passkey or disabling the last strong authenticator.
- Keep at least one usable recovery route. Notify the user when a passkey is enrolled or removed.
- Do not present device biometrics as a server-side credential by themselves; use platform passkey/WebAuthn challenges and verification.

## 5. Data model and API design to investigate

Proposed logical model, subject to a schema and Supabase capability review:

- `user_sessions`: application session ID, user ID, provider session reference/token-family reference, platform, app version, device label, created_at, last_seen_at, expires_at, revoked_at, revocation_reason, current-session marker computed per request.
- `security_events`: user ID, event type, session ID where relevant, timestamp, minimal safe metadata, outcome.
- `user_passkeys`: credential reference, user ID, display label, created_at, last_used_at, revoked_at. Never expose private key material.
- Existing `users` profile record remains the canonical profile; do not duplicate profile fields into session rows.

Candidate API surface:
- `GET /api/v1/account/sessions`
- `DELETE /api/v1/account/sessions/:sessionId`
- `POST /api/v1/account/sessions/revoke-others`
- `POST /api/v1/account/sessions/revoke-all`
- `GET /api/v1/account/security-events`
- `POST /api/v1/account/email/change` and a verification endpoint
- `GET /api/v1/profile`, `PATCH /api/v1/profile`, `POST /api/v1/profile/avatar` remain the profile operations, with strengthened validation and reauthentication rules.
- Passkey endpoints are a later WebAuthn phase, not part of the first release.

All endpoints must enforce user ownership on the server. A session ID supplied by a client must never be enough to revoke another user's session.

## 6. Implementation phases

### Phase A — Stabilize existing email login and persistence
1. Complete PR #45 code review and deploy only to an isolated staging environment after approval.
2. Test fresh email login, cookie receipt, reload, navigation, new tab, browser restart, access-token refresh, logout and fresh browser context.
3. Verify the cookie's Domain, Path, Secure, HttpOnly, SameSite, expiry, CORS and proxy forwarding behavior in browser devtools/network evidence.
4. Fix and test Android refresh-token rotation, transient offline behavior, expired access token, logout and process-restart restoration.
5. Add automated API and web tests for login-vs-register separation, invalid/expired OTP, resend and refresh behavior.

**Exit criteria:** a verified existing account remains signed in after normal web and Android restarts; explicit logout and definitive revocation reliably end the session; temporary network failures do not falsely sign the user out.

### Phase B — Profile parity and safe changes
1. Complete web profile edit and avatar positive/negative tests.
2. Add equivalent native Android profile editing and avatar upload.
3. Add username uniqueness and conflict handling tests.
4. Design and implement secure email-change verification.
5. Add recent-auth checks and security notifications for sensitive changes.

**Exit criteria:** profile data and avatar persist across both clients and reloads; ownership and validation tests pass; email changes cannot occur without verification.

### Phase C — Device/session management
1. Confirm Supabase session and revocation capabilities and select the session registry design.
2. Add per-session registration on web and Android.
3. Add active-device list, per-session revoke, revoke-others and revoke-all endpoints/UI.
4. Add security-event history and notifications.
5. Test revocation propagation to the affected client and race conditions during refresh.

**Exit criteria:** a user can identify and revoke one session, revoke all other sessions, and revoke all sessions; a revoked session cannot refresh or call protected endpoints.

### Phase D — Recovery, passkeys and account lifecycle
1. Define mailbox-loss recovery and support escalation.
2. Add passkeys/WebAuthn as an optional method.
3. Add profile/data export and account deletion.
4. Add abuse monitoring, alerting and security-event retention policy.
5. Run an external security review before broad production rollout.

## 7. Required acceptance test matrix

| Area | Positive test | Negative/security test |
|---|---|---|
| Login | Existing account signs in with email OTP | Login does not create an account |
| Registration | New account created once after OTP verification | Duplicate email/username cannot create a duplicate profile |
| OTP | Valid code accepted once | Expired, reused, malformed and brute-forced codes rejected/rate-limited |
| Web session | Survives reload, new tab and browser restart | Missing/expired/revoked cookie cannot restore account |
| Android session | Survives app force-stop and phone restart | Revoked refresh credential cannot restore account |
| Refresh | Rotation returns and stores new credential | Reuse of old rotated credential is detected and handled |
| Offline | Temporary outage does not corrupt local state | Protected server data is not treated as authorized without valid credentials |
| Profile | Name/username changes persist across clients | Invalid, duplicate or unauthorized edits rejected |
| Avatar | JPG/PNG/WebP upload and replacement persist | Oversize, malformed, spoofed MIME and cross-user upload rejected |
| Sessions | Current and other devices appear accurately | User cannot inspect or revoke another account's sessions |
| Revocation | Individual, revoke-others and revoke-all work | Revoked session cannot refresh or access protected API |
| Email change | New address verified before switch | Unverified address never becomes primary |
| Passkeys | Multiple passkeys enroll and authenticate | Removed credential cannot authenticate |
| Notifications | Security events notify the account owner | Secrets and OTPs never appear in notification/log payloads |

## 8. Release gates and non-goals

- CI success is necessary but not sufficient. Require live staging browser tests and a physical Android device test.
- Separate debug APK build, signed release APK, installability, update compatibility and actual service operation in status reporting.
- Preserve the existing Android application ID and signing key for update compatibility.
- Do not deploy to production, merge draft PRs, apply database migrations, create a new account or modify user profile data without the appropriate explicit authorization.
- Do not store access/refresh tokens in source control, ordinary logs, analytics, crash reports or public storage.
- Do not use browser fingerprinting or IP geolocation as a substitute for authentication.
- Do not silently create accounts during login or silently change account identity during profile edits.
- No password requirement is imposed while email OTP is the selected sign-in method. If passwords are introduced later, follow current OWASP/NIST guidance rather than arbitrary complexity/rotation rules.

## 9. Current work references

- Web same-origin auth/session remediation: https://github.com/derector/SONORA/pull/45 (draft; staging behavior not yet verified).
- Android login-mode and APK workflow changes: https://github.com/derector/SONORA/pull/33 (draft; debug artifact built by Actions run #44501302507).
- Android build run: https://github.com/derector/SONORA/actions/runs/44501302507
- Production web auth QA findings are recorded in `docs/PROVIDER_EXPANSION_PLAN.md` on the provider-roadmap branch. This plan consolidates the auth/session/profile work into its own deliverable.

## 10. Research findings translated into SONORA decisions

1. **Sessions, not just devices:** follow Google's model because one phone can have multiple browser/app sessions.
2. **Separate web and mobile session types:** follow GitHub's clear distinction, but display both in one SONORA screen.
3. **Remote removal:** follow Apple's device removal pattern with server-side revocation, not merely local token deletion.
4. **Global sign-out plus integration revocation:** follow Spotify's distinction between sessions and partner/third-party access.
5. **Reauthentication for sensitive changes:** follow OWASP for email, recovery methods, passkeys and account deletion.
6. **OTP lifecycle:** short-lived, single-use, rate-limited, overwritten on resend and never logged.
7. **Cross-platform consistency:** one account/profile and server policy, but separate secure credentials and session records for web and Android.


## 11. Follow-up source review: Android session restoration (2026-11-19)

A deeper review of the native `SonoraApi.restoreSession()` flow found that a temporary network failure could be treated as a sign-out: refresh failure fell through to `/auth/me`, and any exception caused `logout()`, deleting both the access token and refresh credential from encrypted local storage.

A resilience fix has now been added to the existing Android draft PR #33:
- Distinguish `SIGNED_IN`, `SIGNED_OUT` and `TEMPORARILY_UNAVAILABLE` session-restore outcomes.
- Classify refresh responses so 429 and server/network failures are not treated as definitive credential rejection.
- Validate the existing access token separately after refresh failure.
- Clear local credentials only after the API definitively rejects the access token with 401/403.
- Keep encrypted credentials on temporary failures and show an explicit retry state in the Profile screen.
- Keep server authorization authoritative: retaining credentials offline does not grant access to protected API data until the server validates them.

**Validation status:** source change committed to PR #33; the new Android build has not yet been observed for this follow-up commit. Previous successful debug APK artifact belongs to an earlier commit and does not validate this change. Physical-device behavior remains untested.

This finding reinforces the release criterion: temporary outages must preserve recoverable credentials, while expired/revoked sessions must be rejected and cleared only after a definitive server response.
