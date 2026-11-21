# SONORA roadmap

## Статус проекта

Поиск для приложения и сайта ведёт к воспроизведению в SONORA. При точном совпадении профиля Audius поиск дополнительно запрашивает его каталог, проверяет ID загрузившего трек и исключает недоступные потоки. Карточки исполнителей открывают поиск внутри SONORA, карточки записей предлагают найти доступную версию. Имя артиста в начале названия сторонней записи само по себе не считается кредитом, в том числе при сбое MusicBrainz.

### Проверка запрошенных исполнителей

| Запрос | Подтверждено | Воспроизведение оригиналов в SONORA |
| --- | --- | --- |
| Кишлак | MusicBrainz возвращает записи артиста. В прежней выдаче Audius обнаружен ремикс другого загрузчика. | В проверенной выдаче доступные оригиналы не найдены. |
| Молодой Рубль | Найдены записи с участием исполнителя. Аудио в прежней выдаче совпадало по отдельным словам, исполнители были другими. | В проверенной выдаче подходящее аудио не найдено. |
| N01R | Найден одноимённый профиль Audius `w4rr10r` без загрузок. Записи одноимённых исполнителей могут относиться к разным людям. | Профиль не дал воспроизводимых треков. |

Для расширения каталога под конкретных артистов нужен источник с разрешением на встроенное воспроизведение их записей. SoundCloud документирует такой режим для одобренных интеграций, а его общие условия ограничивают агрегацию потоков без отдельной лицензии. Следующий шаг по покрытию — подтвердить разрешение провайдера или получить записи у правообладателя для каталога SONORA. [SoundCloud API](https://developers.soundcloud.com/docs/api/guide) · [Условия SoundCloud API](https://developers.soundcloud.com/docs/api/terms-of-use)

Каталог правообладателей SONORA добавлен в общий поиск и поиск воспроизводимой версии по ISRC либо по точному совпадению исполнителя и названия. API проверяет разрешение и срок действия при выдаче аудио. В тестах проверены отключённые и просроченные записи и отзыв записи из каталога. Для подключения Кишлака, Молодого Рубля и N01R нужны записи или каталог с разрешением на воспроизведение этих конкретных релизов. [Настройка каталога](music-providers.md#каталог-правообладателей-sonora)

| Направление | Готово и проверено | В разработке и проверке | Предстоит |
| --- | --- | --- | --- |
| Android и OTA | Подписанный QA APK `0.1.236` включает карточки исполнителей и запуск найденной версии в SONORA. На Android 15 ранее проверены уведомление, скачивание, явная установка и отсутствие повторного предложения той же версии. | Проверка нового экрана поиска на телефоне с API из той же ветки. | Публикация релиза и подключение FCM. |
| Сайт прослушивания | В Chromium проверены поиск исполнителя и запуск звука в плеере SONORA, карточки записей и состояние без доступного аудио. | Проверка на боевом API после выпуска. | Проверка входа, очереди, восстановления позиции и медиатеки на двух устройствах. |
| Сайт загрузки | Собрана стеклянная витрина. В Chromium проверены мобильная ширина 360 px, версия и SHA-256 стабильного APK и резервный переход на GitHub. | Подготовка к публикации. | Проверка опубликованной страницы на телефоне и актуальные снимки Android. |
| Музыкальные источники | Поиск доступной версии использует Audius и настроенный Jamendo. Реальный запрос к Audius вернул совпадение. На тестовых данных проверены исключение ограниченных потоков, различие между сбоем и отсутствием совпадения и отсутствие ложного подтверждения по ISRC. | Spotify Web API ограничен метаданными и поддерживаемым рынком. | Проверка доступа, атрибуции и ограничений Spotify. Затем OAuth с возможностью отключить аккаунт и переходом в официальный плеер. |
| Каталог правообладателей | Поиск, сопоставление, атрибуция и маршрутизация аудио реализованы. Тесты API прошли. | Проверка на Android и в браузере. | Подключение разрешённого аудио нужных релизов и проверка воспроизведения на вебе и Android. |

- Установка подписанных APK на Android 15 проверена в [прогоне GitHub Actions](https://github.com/derector/SONORA/actions/runs/44946508932). Уведомление, скачивание и явное подтверждение установки проверены в [прогоне интерфейса Android](https://github.com/derector/SONORA/actions/runs/44949585631).
- До подключения FCM Android узнаёт о релизе через WorkManager при запуске и при периодической проверке. Система определяет фактическое время фоновой проверки и показывает уведомление при включённом разрешении.

## Что брать из существующих плееров

1. Единый поиск с явной доступностью, импорт плейлиста с предварительным просмотром совпадений и видимым исходным источником каждой записи. LANE публично описывает использование API Spotify и SoundCloud для поиска информации. Dotify показывает сценарии импорта, поиска и локальных файлов. [LANE](https://sklane.com/ru/terms-of-service) · [Dotify](https://dotify.fun/) · [Условия Dotify](https://dotify.fun/tos)
2. Восстанавливаемая очередь, предыдущая позиция и понятные состояния офлайна. Для Android опираемся на существующий Media3. Для личных библиотек изучаем OpenSubsonic и сценарии Tempo, Navidrome и Feishin. [Media3](https://github.com/androidx/media) · [Tempo](https://github.com/CappielloAntonio/tempo) · [Navidrome](https://github.com/navidrome/navidrome) · [Feishin](https://github.com/jeffvli/feishin)
3. Раздел профиля с историей, приватностью и управлением подключёнными аккаунтами. ListenBrainz — ориентир для добровольной передачи прослушиваний и независимого профиля истории. [ListenBrainz API](https://listenbrainz.readthedocs.io/en/latest/users/api/index.html)
4. При недоступности записи поиск на Android и в вебе предлагает поиск разрешённой версии по ISRC, исполнителю и названию. Совпадение требует явного запуска пользователем. Метаданные Spotify остаются в отдельном режиме API с правилами атрибуции платформы. Для подключения аккаунта предусмотрен OAuth с PKCE. [Spotify Search](https://developer.spotify.com/documentation/web-api/reference/search) · [Spotify Developer Policy](https://developer.spotify.com/policy)

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
