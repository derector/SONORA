# SONORA music provider integration

## Current provider: Jamendo

SONORA uses the Jamendo v3 API as the first independent-music discovery provider. The API is proxied through the backend so the provider client ID is never placed in browser code.

Configure the API service variable:

```env
JAMENDO_CLIENT_ID=your_jamendo_client_id
```

Create an application and obtain the ID from [Jamendo Developer Portal](https://developer.jamendo.com/). Do not add it to `NEXT_PUBLIC_*` variables.

## Endpoints

- `GET /api/v1/providers/jamendo/tracks`
- Optional query parameters: `q`, `limit` (1-30), `page` (1-100)
- `GET /api/v1/catalog/tracks` returns SONORA's curated database catalog.
- `GET /api/v1/catalog/search?q=...` searches SONORA's database catalog.

Jamendo discovery returns provider metadata, a stream URL, artist attribution, source link and the exact Creative Commons license URL. It does not silently insert provider tracks into SONORA's own database.

## Rights guardrails

The current provider endpoint only returns items with a license URL matching CC BY, CC BY-SA, CC BY-ND or CC0. Non-commercial-only licenses are excluded because they would not be appropriate for a potentially commercial music platform. The user interface keeps attribution, provider source and license links visible beside each player.

This allow-list is a technical first filter, not legal advice or a substitute for checking the track's current license and territory. Do not mark a track `licensed` in SONORA's database based only on a provider ID or a URL. The existing `rights_status` field remains the gate for first-party catalog playback.

## Not yet complete

- A Jamendo client ID must be configured in Railway before the live discovery page can retrieve tracks.
- Provider results have not yet been tested with a real Jamendo application ID.
- Full-length commercial catalog licensing is a separate future integration. Spotify and Apple catalog APIs do not grant SONORA a blanket right to redistribute recordings.
