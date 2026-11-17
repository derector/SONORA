"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

type Language = "en" | "ru";
type LanguageContextValue = { language: Language; setLanguage: (language: Language) => void; t: (value: string) => string };
const LanguageContext = createContext<LanguageContextValue | null>(null);

const ru: Record<string, string> = {
  "Workspace":"Рабочее пространство","Discover":"Обзор","Search":"Поиск","Your library":"Медиатека","Liked tracks":"Любимые треки","Listening history":"История прослушивания","Playlists":"Плейлисты","Your sound, evolving.":"Твой звук меняется.","Personalized discovery is coming as your listening story grows.":"Персональные рекомендации появятся, когда накопится история прослушивания.",
  "Tuesday, your next favorite is waiting.":"Твоя следующая любимая композиция уже ждёт.","Sign in":"Войти","Preview experience":"Предварительная версия","A new way to feel music":"Новый способ почувствовать музыку","Find your":"Найди свою","own frequency.":"частоту.","A calmer space for discovering sounds, collecting moments, and building a soundtrack that feels like yours.":"Пространство для поиска музыки, ярких моментов и создания собственного саундтрека.","Explore your sound":"Открыть музыку","Curated starting points":"Подборки для настроения","Made for the moment":"Под настроение","View all":"Смотреть всё","Editorial mood":"Редакционная подборка","A listening space, not just a feed.":"Музыкальное пространство, а не просто лента.","The foundation is being built. Playback will be enabled only through licensed sources.":"Платформа развивается. Воспроизведение доступно только из разрешённых источников.","SONORA · Early foundation · Music rights first":"SONORA · Ранняя версия · Права на музыку прежде всего",
  "Back to SONORA":"Назад в SONORA","Your music identity":"Твоя музыкальная учётная запись","You’re in.":"Ты вошёл!","Signing out…":"Выходим…","Sign out":"Выйти","Check your inbox.":"Проверь почту.","Enter the six-digit code sent to":"Введи шестизначный код, отправленный на","Verification code":"Код подтверждения","Verify and continue":"Подтвердить и продолжить","Change email or request another code":"Изменить почту или запросить новый код","Create your account.":"Создай аккаунт.","Welcome back.":"С возвращением.","Sign in securely with a one-time code sent to your email.":"Безопасный вход по одноразовому коду из письма.","Create account":"Создать аккаунт","Display name":"Отображаемое имя","How should we call you?":"Как к тебе обращаться?","Username":"Имя пользователя","Email address":"Электронная почта","Send email code":"Отправить код","Protected by Supabase Auth. Your refresh session is stored in a secure HttpOnly cookie.":"Защита Supabase Auth. Сессия хранится в защищённой HttpOnly-cookie.",
  "Discover independent music":"Открывай независимую музыку","Find your next frequency.":"Найди свою следующую частоту.","Explore independent tracks from Jamendo. Every result carries its creator, source and Creative Commons license details. Playback is offered only where the track and provider terms permit it.":"Исследуй независимую музыку Jamendo. У каждого трека указаны автор, источник и лицензия Creative Commons. Воспроизведение доступно в рамках условий площадки и лицензии.","Tracks to explore":"Музыка для открытия","Powered by Jamendo":"На платформе Jamendo","Loading the catalog…":"Загружаем каталог…","Catalog connection is not ready.":"Каталог пока недоступен.","The provider API key must be configured server-side. No demo tracks are substituted.":"Нужно настроить API-ключ провайдера на сервере. Демонстрационные треки не подставляются.","No tracks found. Try another search.":"Ничего не найдено. Попробуй другой запрос.","Independent release":"Независимый релиз","Play track":"Слушать","Pause":"Пауза","Play":"Воспроизвести","CC license":"Лицензия CC","License":"Лицензия","Artist:":"Исполнитель:","Source:":"Источник:","License terms apply.":"Действуют условия лицензии.","SONORA · Independent music discovery · Rights and attribution stay attached to every track":"SONORA · Открытие независимой музыки · Права и атрибуция сохраняются у каждого трека",
  "Your saved music":"Твоя сохранённая музыка","Keep the good ones close.":"Сохраняй любимое рядом.","Jamendo tracks you save are stored in your SONORA account with their original source and license details.":"Сохранённые треки Jamendo хранятся в аккаунте SONORA вместе с исходными ссылками и сведениями о лицензии.","Loading your favorites…":"Загружаем избранное…","Sign in to see your saved tracks.":"Войди, чтобы увидеть сохранённые треки.","Sign in or create account":"Войти или создать аккаунт","Your favorites shelf is empty.":"Здесь пока пусто.","Save a track from Discover and it will appear here.":"Сохрани трек в разделе «Обзор», и он появится здесь.","Explore music":"Открыть музыку","Your collection":"Твоя коллекция","Saved tracks":"Сохранённые треки",
  "Your listening trail":"Твоя музыкальная история","Recently heard.":"Недавно прослушано.","Real playback events from your SONORA sessions. Plays, completed tracks and skips are recorded separately.":"Здесь реальные события воспроизведения SONORA. Запуски, завершения и пропуски записываются отдельно.","Loading listening history…":"Загружаем историю…","Sign in to see your history.":"Войди, чтобы увидеть историю.","Your listening history is empty.":"История пока пуста.","Play a track in Discover and it will appear here.":"Включи трек в разделе «Обзор», и он появится здесь.","Your activity":"Твоя активность","Listening events":"События прослушивания","Finished":"Дослушано","Skipped":"Пропущено","Played":"Воспроизведено",
  "Your personal collection":"Твоя личная коллекция","Sound, in your order.":"Музыка в твоём порядке.","Create and manage your own playlists. They are stored in your SONORA account, not just in this browser.":"Создавай плейлисты и управляй ими. Они хранятся в аккаунте SONORA, а не только в браузере.","Restoring your session…":"Восстанавливаем сессию…","Sign in to see your library.":"Войди, чтобы открыть медиатеку.","Your playlists are private to your account until you choose otherwise.":"Твои плейлисты приватны, пока ты не решишь иначе.","Sign in or create account":"Войти или создать аккаунт","Create a playlist":"Создать плейлист","Playlist name":"Название плейлиста","A short description (optional)":"Краткое описание (необязательно)","Create":"Создать","Your library":"Медиатека","Your playlists":"Твои плейлисты","Your first playlist starts here.":"Начни с первого плейлиста.","Create one above. You can add catalog tracks as the music catalog is connected.":"Создай его выше. Добавление треков станет доступно через каталог.","No description":"Без описания","Public":"Публичный","Private":"Приватный","Playlist created.":"Плейлист создан.","Playlist deleted.":"Плейлист удалён.","Delete":"Удалить",
  "Previous track":"Предыдущий трек","Next track":"Следующий трек","Toggle queue":"Открыть очередь","Close queue":"Закрыть очередь","Up next ·":"Далее ·","Seek through track":"Перемотка трека","Volume":"Громкость","Original":"Оригинал","Speed up":"Ускорить","Slowed":"Замедлить","Playback version":"Версия воспроизведения",
  "Import tracks": "Импорт музыки",
  "Bring your music together": "Собери всю музыку в одном месте",
  "Import tracks from other platforms.": "Импортируй треки с других площадок.",
  "Bring in a playlist export or a list of tracks. SONORA will search its licensed catalog, show possible matches and let you save the tracks you choose.": "Загрузи экспорт плейлиста или список композиций. SONORA найдёт совпадения в каталоге с лицензией и позволит сохранить выбранные треки.",
  "Sign in to import music.": "Войди, чтобы импортировать музыку.",
  "Source platform": "Исходная площадка",
  "Playlist export or track list": "Экспорт плейлиста или список треков",
  "Paste CSV rows or one track per line: Artist - Track title": "Вставь CSV или укажи по одному треку в строке: Исполнитель - Название",
  "tracks detected": "треков обнаружено",
  "up to 100 per import": "до 100 за импорт",
  "Find matches": "Найти совпадения",
  "Import review": "Проверка импорта",
  "Choose your matches": "Выбери совпадения",
  "Import selected": "Импортировать выбранное",
  "Imported": "Импортировано",
  "Open source": "Открыть источник",
  "How importing works": "Как работает импорт",
  "Export a playlist as CSV from the source service, or paste lines in Artist - Track title format. Plain playlist URLs alone do not expose protected track metadata. SONORA imports matches from its own licensed Jamendo catalog; it does not download audio from Spotify, Apple Music or other services.": "Экспортируй плейлист в CSV из исходного сервиса или вставь строки в формате Исполнитель - Название. Одна ссылка на плейлист не раскрывает защищённые метаданные. SONORA ищет совпадения в собственном лицензированном каталоге Jamendo и не скачивает аудио из Spotify, Apple Music и других сервисов.",
  "Paste a playlist CSV or track list first.": "Сначала вставь CSV плейлиста или список треков.",
  "Import is limited to 100 tracks per batch.": "За один раз можно импортировать не более 100 треков.",
  "Search failed.": "Ошибка поиска.",
  "No licensed match found.": "Лицензионных совпадений не найдено.",
  "Matching complete:": "Поиск завершён:",
  "tracks found.": "треков найдено.",
  "Select at least one matched track.": "Выбери хотя бы один найденный трек.",
  "Could not save this track.": "Не удалось сохранить этот трек.",
  "Import failed.": "Ошибка импорта.",
  "Added to your SONORA library:": "Добавлено в медиатеку SONORA:",
  "Original": "Оригинал",
  "Speed up": "Ускорить",
  "Slowed": "Замедлить",
  "Playback version": "Версия воспроизведения",
  "Up next": "Далее",
  "tracks": "треков",
  "Volume": "Громкость",
  "Seek through track": "Перемотка трека",
  "Next track": "Следующий трек",
  "Toggle queue": "Открыть очередь",
  "Close queue": "Закрыть очередь",
  "Import": "Импорт",
  "IMPORT": "ИМПОРТ",
  "Open catalog": "Открытый каталог",
  "Jamendo": "Jamendo",
  "FAVORITES": "ИЗБРАННОЕ",
  "HISTORY": "ИСТОРИЯ",
  "PLAYLISTS": "ПЛЕЙЛИСТЫ",
};

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>("en");
  useEffect(() => {
    const saved = window.localStorage.getItem("sonora-language");
    if (saved === "ru" || saved === "en") setLanguageState(saved);
  }, []);
  useEffect(() => { document.documentElement.lang = language; }, [language]);
  const setLanguage = (next: Language) => {
    setLanguageState(next);
    window.localStorage.setItem("sonora-language", next);
  };
  const value = useMemo(() => ({ language, setLanguage, t: (value: string) => language === "ru" ? (ru[value] ?? value) : value }), [language]);
  return <LanguageContext.Provider value={value}>{children}<div className="fixed right-3 top-3 z-[70] flex rounded-full border border-white/10 bg-[#10111a]/90 p-1 shadow-xl backdrop-blur-xl" aria-label="Language"><button type="button" onClick={() => setLanguage("en")} aria-pressed={language === "en"} className={`rounded-full px-3 py-1.5 text-[11px] font-semibold ${language === "en" ? "bg-violet-200 text-[#171323]" : "text-slate-400"}`}>EN</button><button type="button" onClick={() => setLanguage("ru")} aria-pressed={language === "ru"} className={`rounded-full px-3 py-1.5 text-[11px] font-semibold ${language === "ru" ? "bg-violet-200 text-[#171323]" : "text-slate-400"}`}>RU</button></div></LanguageContext.Provider>;
}
export function useLanguage() {
  const value = useContext(LanguageContext);
  if (!value) throw new Error("useLanguage must be used inside LanguageProvider");
  return value;
}
