const MOOD_QUERIES: Array<{ words: string[]; query: string; label: string }> = [
  { words: ["relax", "calm", "chill", "релакс", "спокойн", "отдых", "медитац", "ambient"], query: "calm ambient relaxation", label: "Спокойствие" },
  { words: ["focus", "study", "work", "фокус", "работа", "учёб", "учеб", "концентр"], query: "lofi study focus", label: "Фокус" },
  { words: ["energy", "energetic", "workout", "run", "gym", "бодр", "энерг", "тренировк", "тренеровк", "пробежк", "спорт"], query: "upbeat electronic energy", label: "Энергия" },
  { words: ["party", "dance", "club", "вечеринк", "танц", "дискотек"], query: "party dance", label: "Вечеринка" },
  { words: ["sleep", "night", "dream", "сон", "сном", "ночн", "расслабь и усни"], query: "sleep dreamy", label: "Сон" },
  { words: ["happy", "fun", "bright", "весел", "радост", "классн", "позитив"], query: "happy upbeat indie", label: "Радость" },
  { words: ["sad", "melanchol", "груст", "печал", "минор"], query: "sad piano melancholic", label: "Меланхолия" },
  { words: ["jazz", "джаз", "swing", "свинг"], query: "jazz swing", label: "Джаз" },
  { words: ["classical", "orchestral", "классич", "оркестр", "фортепиано", "piano"], query: "classical piano orchestral", label: "Классика" },
  { words: ["rock", "рок", "гитар", "метал", "metal", "punk"], query: "rock guitar", label: "Рок" },
  { words: ["electronic", "electro", "synth", "электрон", "синт", "techno", "house"], query: "electronic synth", label: "Электроника" }
];
export type AssistantIntent = {
  action: "search" | "create_playlist" | "similar" | "explain" | "greeting";
  query: string; label: string; playlistName?: string;
};
export function parseAssistantMessage(rawMessage: string): AssistantIntent {
  const message = rawMessage.toLowerCase();
  const wantsPlaylist = /(плейлист|playlist|собери|сделай|create|make|создай|микс)/.test(message);
  const wantsSimilar = /(похож|like|similar|в духе|рядом с|аналогичн)/.test(message);
  const wantsExplain = /(почему|why|recommend|что слушать|посоветуй|подбери|по моим вкусам|мой микс|для меня)/.test(message);
  const direct = /^(?:найди|включи|поставь|поищи|find|play|search)\s+(?:трек\s+|песню\s+)?(.+)$/iu.exec(rawMessage.trim());
  if (direct && !MOOD_QUERIES.some((entry) => entry.words.some((word) => direct[1].toLowerCase().startsWith(word)))) {
    return { action: "search", query: direct[1].trim(), label: direct[1].trim() };
  }
  const mood = MOOD_QUERIES.find((entry) => entry.words.some((word) => message.includes(word)));
  const artistMatch = /(?:похож[ееа]? на|like|в духе|аналогичн[а-я]* )\s*([a-zа-яё0-9][a-zа-яё0-9 .+&_-]{1,59})/i.exec(rawMessage.trim());
  if (wantsSimilar && artistMatch?.[1]) {
    const query = artistMatch[1].trim();
    return { action: "similar", query, label: query, playlistName: wantsPlaylist ? `В духе ${query}` : undefined };
  }
  if (mood) {
    return {
      action: wantsPlaylist ? "create_playlist" : "search",
      query: mood.query, label: mood.label,
      playlistName: wantsPlaylist ? `Микс: ${mood.label}` : undefined
    };
  }
  if (wantsExplain && !wantsSimilar) {
    return { action: "explain", query: "", label: "recommendations" };
  }
  if (/(привет|здравств|hello|hi|start)/.test(message) && message.length < 40) {
    return { action: "greeting", query: "", label: "greeting" };
  }
  // Free text: strip command words and search the remainder.
  const stripped = rawMessage.trim()
    .replace(/^(?:(?:собери|создай|сделай|найди|включи|поставь|поищи|пожалуйста|мне|трек|песню|плейлист|playlist|create|make|find|play|search)\s+)+/iu, "")
    .trim();
  return { action: "search", query: stripped || rawMessage.trim().slice(0, 60), label: "search" };
}
