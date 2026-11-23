export type PlaybackCommand = "pause" | "resume" | "mix" | null;
/** Whole-utterance matching keeps names such as «Найди Пауза» searchable. */
export function playbackCommand(text: string): PlaybackCommand {
  const command = text.toLowerCase().replace(/ё/g, "е").replace(/[.!?,]/g, "").replace(/\s+/g, " ").trim();
  if (["пауза", "останови музыку", "поставь на паузу", "стоп"].includes(command)) return "pause";
  if (["продолжить", "продолжи", "продолжи музыку", "возобнови музыку"].includes(command)) return "resume";
  if (["слушать", "слушать подборку", "включи подборку", "включи микс"].includes(command)) return "mix";
  return null;
}
