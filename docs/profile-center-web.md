# Profile Center web contract

The web UI lives in `/profile`. It uses the existing auth provider access token, existing `TrackRow`, `Rail`, skeletons and `Reveal` primitives. The nine tabs are keyboard navigable and horizontally scroll on narrow screens. No new API handlers are introduced.

## Identity and media

- `GET /api/v1/profile` hydrates identity. `PATCH /api/v1/profile` updates `displayName` and `username`.
- The UI detects extended support from the presence of `bio` in the own profile GET. Only when present does it send `bio`, `status`, `links`, `favoriteGenres`, and `accent`. Links are limited to three; genres to twelve; public HTTPS URLs are required.
- `POST /api/v1/profile/avatar` and `/profile/cover` send `{contentType, base64}`. `DELETE` on those same paths removes images. The UI caps both at 2 MB, because the current Fastify body limit is 3 MB and base64 inflates image size. The cover route advertises 3 MB but cannot accept all such requests through that global limit.
- Gradient IDs match the API `ACCENT_PRESETS`: `aurora`, `violet`, `ocean`, `sunset`, `forest`, `mono`. They are disabled until extended fields are confirmed. Choosing one persists the accent then removes an uploaded cover, not a browser-only pretend save.
- Sharing copies the canonical `/u/<username>` URL, falling back to native sharing and finally a copy prompt.

## Existing libraries

The initial lazy panes reuse the existing favorites, playlists and history pages; each is only mounted while active. Favorites and history retain real licensed playback lookups and the existing player context. Playlist links retain their existing destination and mutations.

## API gaps found at merged tip fb07d8b

The API implementation at commit `9ff9dfc` added full `GET /profile` and extended PATCH logic to `index.ts`. The later merge selected main's base handlers instead: the current `GET /profile` and PATCH only read/update name, username and avatar. The new routes in `profile-routes.ts` remain registered. **This UI lane does not modify `apps/api`.** Extended edit controls and preset saving are disabled rather than falsely reporting success.

The migration 010 `public_profiles` view does not project `show_history`, while `publicTarget()` selects it. Public profiles, user follow and follower list requests can therefore return a real 503 until that API/schema mismatch is resolved. The UI must treat these failures as unavailable, never as empty successful responses.

There is no DELETE listening-history endpoint at this tip. A server-side clear-history button cannot be honestly wired; do not silently clear only browser state or call an invented endpoint.

Migration 010 and storage bucket provisioning remain deployment prerequisites. No SQL or API edits are made in this lane.
