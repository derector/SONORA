# SONORA Playlist Import Improvements

## Current behavior audited on main
- Web import screen accepts pasted CSV or plain text list.
- Parser recognizes track/title and artist column headers, but album is currently parsed then unused.
- User selects a source label (Spotify, Apple Music, YouTube Music, SoundCloud, Yandex, VK, Telegram, Other/CSV); selection is informational and is not used to authenticate or query the selected platform.
- Matching requests are sent only to Jamendo search, in batches of five, capped at 100 rows.
- User selects candidate matches and imports them to favorites via provider-favorites endpoint.
- It does not import provider playlist URLs or directly recreate playlist structure.
- Import is match-to-favorites, not playlist creation; preserve this distinction in UI copy.

## Implementation priorities
1. Clarify UI copy: source dropdown indicates the export's origin, not a live integration; never imply connected platform access.
2. Improve CSV parser: use album column as an optional disambiguation hint; robustly handle BOM, CRLF, quoted cells and common column header aliases.
3. Add matching providers incrementally using existing provider endpoints and only playable/authorized results; show provider badge and license/source links.
4. Add preview with matched/unmatched rows, confidence labels based on deterministic metadata similarity (not fake AI certainty), and user-selectable candidate.
5. Save selected tracks to a newly-created or selected SONORA playlist, not favorites only; maintain stable provider-qualified IDs to avoid collisions.
6. Add duplicate detection across selected rows and current playlist.
7. Add safe URL support only for playlist exports or official provider links with documented APIs. Do not scrape logged-in platform pages or use private APIs.
8. Add Android parity: import file via SAF, parse locally, match through SONORA API, review matches, save playlist.
9. Tests: quoted CSV commas/escaped quotes, BOM, headers/no headers, artist-title separators, blank lines, duplicates, 100-row cap, network failures, wrong provider match, favorite-vs-playlist persistence.
10. Add visible source attribution and license details for imported catalog items.

## Suggested acceptance criteria
- Import preview never writes until user confirms.
- Matching results distinguish playable tracks from metadata-only.
- No provider auth tokens or platform credentials are requested in SONORA paste workflow.
- Playlist name and order are retained when the import format contains them.
- Failed matches are recoverable without repeating successful rows.
- Mobile import workflow is usable at narrow viewport sizes.
