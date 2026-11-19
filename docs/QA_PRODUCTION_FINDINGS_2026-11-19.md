# SONORA production QA findings (2026-11-19)

Read-only browser review of the production web app. No account was created, no form was submitted, and no profile or settings data was changed.

## Routes

- `/auth` is the registration and sign-in entry point. Registration asks for display name, username and email, then sends an eight-digit email code.
- `/profile` redirects to `/auth` while signed out, as expected.
- `/settings` is publicly viewable; its profile link points to `/profile`.
- `/register` and `/signup` previously returned 404. This PR adds redirects to `/auth` for both legacy paths.
- Home, Search, Discover, Playlists, Favorites, History and Import routes loaded during the read-only review.

## Live search observations

- `молодой рубль`: no exact track result; Audius returned unrelated artist-name matches.
- `Кишлак`: one playable Audius remix by another uploader and MusicBrainz metadata matches, not a verified official catalog.
- `БРЕДИШЬ`: no matches in the visible providers; MusicBrainz reported unavailable in that request.

The SoundCloud priority-artist work in PRs #42 and #43 is separate and not merged. It uses provider-hosted embeds for a curated seed list, not a general provider search integration. Verify every canonical track URL and live embed before merging.

## Auth/profile verification still required

- Trigger a fresh registration email to the owner-provided test mailbox and verify the code in the real browser flow.
- Confirm duplicate-email and duplicate-username handling.
- Confirm successful OTP verification creates the profile row and sets the refresh cookie.
- Reload the site and reopen it in a fresh browser context to verify session restoration.
- Test profile name/username updates, username conflict handling, avatar upload (JPG/PNG/WebP, <=2 MB), avatar persistence and image replacement.
- Verify avatar storage bucket policies, object ownership and cache invalidation.
- Test logout and confirm refresh cookie invalidation.

Historical SONORA OTP messages were found in the connected mailbox dated 2026-11-17. They are not fresh test codes and must not be reused. No OTP code is copied into this report.

## Current limitations

The browser review was signed out and intentionally read-only. It did not prove successful registration, session persistence, profile mutation, avatar storage, or playback of embedded SoundCloud tracks. Production was not changed by the browser review.
