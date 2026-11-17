# Architecture

## Runtime boundaries

- **Web app** renders the product experience. It must never receive database credentials, provider secrets or the session signing secret.
- **API** owns authentication, authorization, catalog normalization, playback entitlement checks, listening events and recommendation ranking.
- **PostgreSQL** stores first-party identity, collections and consent-aware listening history.
- **Catalog adapters** normalize provider metadata. Playback adapters separately enforce each provider's allowed playback mode, territories and attribution requirements.

## Data and rights

Track metadata and playback rights are separate concerns. A track can be discoverable while playback is unavailable, preview-only or restricted by territory. The API must resolve rights immediately before playback and must not proxy or redistribute provider audio unless the provider contract explicitly permits it.

## Recommendation baseline

Start with transparent signals: followed artists, saved tracks, playlist additions, completed listens and explicit dislikes. Apply recency and diversity controls. Do not infer sensitive traits. Provide controls to clear listening history and disable personalization before enabling behavioral ranking.

## Security baseline

- Validate all request payloads at the API boundary.
- Use secure, HTTP-only, same-site cookies for browser sessions.
- Hash credentials and one-time codes; never log secrets or raw tokens.
- Rate-limit login, search and public profile endpoints.
- Enforce ownership checks for private playlists and user data.
- Keep audit events for privileged operations.
