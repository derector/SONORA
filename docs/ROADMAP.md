# SONORA roadmap

## Статус проекта

| Направление | Готово и проверено | В разработке и проверке | Предстоит |
| --- | --- | --- | --- |
| Android и OTA | Подписанные APK установлены поверх прежних версий на Android 15. Внутри SONORA проверены загрузка, установка `0.1.199 → 0.1.200` и повторная проверка версии. | Уведомление о релизе и раздельные действия «Обновить» и «Установить». Стеклянная навигация и карточки ссылок на записи. | Прогон на физическом Android и публикация проверенного релиза. Для мгновенной доставки подключить FCM к событиям публикации релизов. |
| Сайт прослушивания | Собрана версия со стеклянной навигацией и мини-плеером. В Chromium проверены поиск, ссылки на метаданные и аудиоплеер на тестовых ответах API. | Финальная проверка с подключёнными каталогами. | Проверка входа, очереди, восстановления позиции и медиатеки на двух устройствах. |
| Сайт загрузки | Собрана стеклянная витрина. В Chromium проверены мобильная ширина 360 px, версия и SHA-256 стабильного APK и резервный переход на GitHub. | Подготовка к публикации. | Проверка опубликованной страницы на телефоне и актуальные снимки Android. |
| Музыкальные источники | Поиск и импорт используют разрешённые источники. На тестовых ответах проверено разделение аудио и внешних ссылок для Audius, MusicBrainz и Spotify. | Добавлены карточки совпадений на Android и в вебе. Spotify Web API ограничен метаданными и поддерживаемым рынком. | Проверка оформленного доступа Spotify, атрибуции и ограничений. Затем OAuth с отзывом доступа и переходом в официальный плеер. |

- Установка подписанных APK на Android 15 проверена в [прогоне GitHub Actions](https://github.com/derector/SONORA/actions/runs/44946508932). Встроенный цикл с повторной проверкой воспроизведён в [отдельном прогоне](https://github.com/derector/SONORA/actions/runs/44948255785).
- До подключения FCM Android узнаёт о релизе через WorkManager при запуске и при периодической проверке. Система определяет фактическое время фоновой проверки и показывает уведомление при включённом разрешении.

## Что брать из существующих плееров

1. Единый поиск с явной доступностью, импорт плейлиста с предварительным просмотром совпадений и видимым исходным источником каждой записи. LANE публично описывает использование API Spotify и SoundCloud для поиска информации. Dotify показывает сценарии импорта, поиска и локальных файлов. [LANE](https://sklane.com/ru/terms-of-service) · [Dotify](https://dotify.fun/) · [Условия Dotify](https://dotify.fun/tos)
2. Восстанавливаемая очередь, предыдущая позиция и понятные состояния офлайна. Для Android опираемся на существующий Media3. Для личных библиотек изучаем OpenSubsonic и сценарии Tempo, Navidrome и Feishin. [Media3](https://github.com/androidx/media) · [Tempo](https://github.com/CappielloAntonio/tempo) · [Navidrome](https://github.com/navidrome/navidrome) · [Feishin](https://github.com/jeffvli/feishin)
3. Раздел профиля с историей, приватностью и управлением подключёнными аккаунтами. ListenBrainz — ориентир для добровольной передачи прослушиваний и независимого профиля истории. [ListenBrainz API](https://listenbrainz.readthedocs.io/en/latest/users/api/index.html)
4. При недоступности записи на Android или в вебе показываем официальный источник и ищем разрешённую версию по ISRC, исполнителю и названию. Совпадения с другой записью требуют выбора пользователя. Превью используем в разрешённом контексте. Для Spotify используем официальный рынок и ссылку, при подключении аккаунта — OAuth с PKCE. [Spotify Search](https://developer.spotify.com/documentation/web-api/reference/search) · [Spotify Developer Policy](https://developer.spotify.com/policy) · [iTunes Search API](https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/iTuneSearchAPI/)

## Phase 0: foundation
- [x] Establish a clean monorepo and initial web/API shells
- [ ] Verify cloud builds and deploy preview
- [ ] Provision PostgreSQL and migrations

## Phase 1: identity and library
- [ ] Email sign-in with verified sessions
- [ ] User profile and privacy settings
- [ ] Saved tracks, albums and playlists
- [ ] Search API and catalog-provider abstraction

## Phase 2: licensed listening
- [ ] Select providers with explicit playback rights
- [ ] Entitlement-aware playback resolver
- [ ] Player queue, progress, volume and device state
- [ ] Rights-aware availability and territory handling

## Phase 3: discovery
- [ ] Listening event model with consent and retention controls
- [ ] Explainable recommendations and editorial collections
- [ ] Taste profile and feedback controls

## Phase 4: community and operations
- [ ] Follow profiles and share playlists
- [ ] Moderation and abuse reporting
- [ ] Admin tools, audit logs and operational dashboards
- [ ] Automated tests, rate limits and security review

A roadmap item is complete only after implementation and verification. UI placeholders are not counted as shipped functionality.
