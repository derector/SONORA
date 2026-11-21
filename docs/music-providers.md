# SONORA music provider policy and integration plan

Updated: 2026-11-21

## Каталог правообладателей SONORA

LANE публично описывает метаданные Spotify и SoundCloud. Dotify описывает импорт плейлистов и воспроизведение через внешние площадки. Документация не раскрывает подробности выдачи аудио для каждого трека. Для воспроизведения в SONORA оператор может подключить отдельный каталог с записями, право на которые подтверждено. [LANE](https://sklane.com/ru/terms-of-service) · [Dotify FAQ](https://dotify.fun/faq) · [Dotify Terms](https://dotify.fun/tos)

Оператор API хранит JSON отдельно от репозитория. Укажи абсолютный путь в `SONORA_LICENSED_CATALOG_FILE`, публичный HTTPS origin медиа в `SONORA_LICENSED_AUDIO_ORIGIN` и публичный HTTPS origin API в `SONORA_LICENSED_API_ORIGIN`. Эти три настройки подключают каталог к существующему поиску на сайте и Android. Медиа можно хранить на том же HTTPS origin, если сервер действительно отдаёт записи по указанным путям.

```json
[
  {
    "id": "demo-recording",
    "title": "Демонстрационная запись",
    "artist": "Тестовый артист",
    "album": "Демо",
    "durationSeconds": 120,
    "audioPath": "tracks/demo-recording.mp3",
    "rightsHolder": "Название правообладателя",
    "licenseRef": "Внутренний номер разрешения",
    "streamingAllowed": true,
    "availableUntil": "2027-12-31T23:59:59Z"
  }
]
```

- `id` должен оставаться стабильным. `audioPath` задаёт относительный путь к записи на настроенном origin. Для совместимости сайта и Android используй HTTPS-доставку с MIME аудио и поддержкой диапазонов байтов.
- Дополнительные поля `isrc`, `artworkUrl`, `sourceUrl` и `licenseUrl` обогащают выдачу. ISRC применяется для точного сопоставления записей. Внутренний номер разрешения остаётся на сервере.
- В этот каталог попадают только записи с разрешением на воспроизведение для всей аудитории конкретного развёртывания. Укажи время окончания в UTC. Значение `null` подходит для бессрочного разрешения.
- Для снятия записи установи `streamingAllowed` в `false` или убери запись из файла. Публикуй файл заменой через rename. Новые запросы плеера перестанут получать адрес аудио. Архивы, публичные плейлисты и офлайн-скачивание в этой интеграции пока не подключены.

## What is connected today

- **Jamendo**: catalog search and playable audio in non-commercial mode. Tracks are checked for a known Creative Commons license before being added to playlists.
- **Audius**: federated track/artist search and playback only when the official response marks a track streamable and not stream-gated. Audius playlist persistence is not yet enabled.
- **MusicBrainz**: recording and artist metadata only. It is not an audio host and must never be represented as playable.
- **VK Music**: not connected. The public VK API does not provide a supported general-purpose third-party audio catalog/streaming interface. VK ID authorization is an identity/login product and must not be described as authorization to access VK Music audio.

## VK research and decision

Moozza advertises VK library, playlists, recommendations, search and playback. That describes its product behavior, not a public integration contract available to SONORA.

VK's own historical explanation states that it could not keep the public audio-recordings API available to third-party developers because of rights-holder obligations. The current VK ID SDK supports OAuth 2.1, but VK ID login does not by itself grant access to the private VK Music catalog. Unofficial clients found in public repositories use private/internal endpoints and client-specific tokens or cookies. Those mechanisms are not a stable or supported public API and may conflict with VK rules.

SONORA therefore:
1. Never asks users for their VK password, session cookies, or tokens copied from another application.
2. Does not impersonate official VK clients or call undocumented private audio endpoints.
3. Offers an outbound link to the official VK Music service.
4. Can add VK ID account linking later for identity/profile features only, after the app is registered and OAuth 2.1 Authorization Code + PKCE is configured.
5. Enables VK audio streaming only if VK provides SONORA a documented partner/API entitlement that explicitly permits catalog access and playback.

## Recommendation engine principles

Recommendations must be generated from actual signals, not fabricated "AI" labels:
- Explicit favorites and dislikes (strongest signals).
- Listening completion and skips, with recency decay.
- Repeated artists, genres/tags, moods and release periods where provider metadata supplies them.
- Diversity controls to avoid returning the same artist repeatedly.
- Provider and rights eligibility as a hard filter before ranking.
- Explanations such as "because you liked this artist" only when the underlying event exists.

A recommendation response should expose its source and reason, and should never turn metadata-only MusicBrainz recordings into playable tracks.

## Next implementation milestones

1. Persist Audius tracks in user playlists using official Audius track IDs, verifying streamability and non-gated status server-side before insert and again before playback.
2. Add a cross-provider recommendation endpoint using the user's real favorites/listening history and provider metadata.
3. Add user-controlled provider connections with OAuth 2.1/PKCE where an official provider API supports the needed scope.
4. Keep Spotify/Apple integrations capability-aware: catalog access, library access and full playback are separate permissions and must be surfaced honestly.
5. Add a provider health/rights status display so users can distinguish playable audio, metadata-only matches, and external links.

## Research references

- Moozza product description: https://www.mozza.tech/
- VK explanation of the public audio API change: https://downloads.ctfassets.net/nn534z2fqr9f/2HZJwOFN1KcWaKE8MYcm86/5fb66d24428853dc89614bdd2fccd55d/egor-presentation-one.pdf
- VK ID official SDK (OAuth 2.1): https://github.com/VKCOM/vkid-web-sdk
- VK rules: https://dev.vk.com/rules
- Audius API: https://docs.audius.co/api/
- Spotify Web Playback SDK: https://developer.spotify.com/documentation/web-playback-sdk/reference
- Apple MusicKit JS: https://js-cdn.music.apple.com/musickit/v3/docs/iframe.html?id=user-authorization--page


## Moozza assessment (2026-11-18)

The official Moozza site describes VK library, playlists, recommendations, offline cache, radio and local-file playback in its Android app. Its public privacy policy names an internal service host (`api.mozza.tech`) but does not publish a developer API, OAuth client registration, SDK, endpoint specification, or third-party account-linking contract. The policy describes VK authentication and music access as app/device-side behavior; it does not grant SONORA permission to reuse Moozza sessions, tokens, or audio streams.

Decision:
- Show Moozza as an optional external Android companion from SONORA Settings.
- Link only to the official Google Play listing and official Moozza website.
- Do not scrape its private API, extract app tokens, proxy its streams, or request VK credentials in SONORA.
- Revisit native SONORA ↔ Moozza integration only if the developer provides a documented API/SDK and explicit permission. A support/partnership request may be sent to support@mozza.tech, but no request has been sent.
- This is an outbound handoff, not a connected provider: no shared login, synchronized library, SONORA queue control, or playback inside the SONORA player.

References:
- https://www.mozza.tech/
- https://www.mozza.tech/privacy/
- https://play.google.com/store/apps/details?id=ru.euphoria.moozza.new
