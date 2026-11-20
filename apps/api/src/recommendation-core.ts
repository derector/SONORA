export type TasteSignal = {
  artist?: string;
  genres?: string[];
  liked?: boolean;
  skipped?: boolean;
  plays?: number;
};

export type RecommendationTrack = {
  id: string;
  title: string;
  artist: string;
  genres?: string[];
  durationSeconds?: number | null;
};

export type RankedRecommendation = RecommendationTrack & {
  score: number;
  reasons: string[];
};

/** Shared text normalizer: lowercase, ё→е, accent/diacritic folding, punctuation folding. */
export const normalize = (value: string) =>
  value.normalize("NFKD").toLowerCase().replace(/[ё]/g, "е").replace(/[^a-zа-я0-9]+/g, " ").trim();

/** Deterministic, network-free ranking core. Feed it catalog candidates and taste signals. */
export function rankRecommendations(
  candidates: RecommendationTrack[],
  taste: TasteSignal[],
  limit = 20
): RankedRecommendation[] {
  const requestedLimit = Number.isFinite(limit) ? Math.floor(limit) : 20;
  if (requestedLimit <= 0 || candidates.length === 0) return [];

  // Provider-qualified IDs are expected; repeated catalog rows for the same ID must not
  // produce duplicate recommendations.
  const uniqueCandidates = Array.from(
    new Map(candidates.filter((track) => track.id.trim()).map((track) => [track.id, track])).values()
  );

  const liked = taste.filter((s) => s.liked && !s.skipped);
  const skipped = taste.filter((s) => s.skipped);
  const likedArtists = new Set(liked.map((s) => normalize(s.artist ?? "")).filter(Boolean));
  const dislikedArtists = new Set(skipped.map((s) => normalize(s.artist ?? "")).filter(Boolean));
  const genreWeights = new Map<string, number>();
  for (const signal of taste) {
    const weight = signal.skipped ? -2.5 : signal.liked ? 2.2 : Math.min(1.2, (signal.plays ?? 0) * 0.12);
    for (const genre of signal.genres ?? []) {
      const key = normalize(genre);
      if (key) genreWeights.set(key, (genreWeights.get(key) ?? 0) + weight);
    }
  }
  const ranked = uniqueCandidates.map((track) => {
    const artist = normalize(track.artist);
    const genres = (track.genres ?? []).map(normalize).filter(Boolean);
    const reasons: string[] = [];
    let score = 0;
    if (likedArtists.has(artist)) { score += 4; reasons.push("любимый исполнитель"); }
    if (dislikedArtists.has(artist)) score -= 5;
    const genreScore = genres.reduce((sum, genre) => sum + (genreWeights.get(genre) ?? 0), 0);
    if (genreScore > 0) reasons.push("любимые жанры");
    score += Math.max(-4, Math.min(5, genreScore));
    if (track.durationSeconds && track.durationSeconds >= 90 && track.durationSeconds <= 600) score += 0.15;
    return { ...track, score, reasons };
  });
  ranked.sort((a, b) => b.score - a.score || normalize(a.title).localeCompare(normalize(b.title)));
  const artistCounts = new Map<string, number>();
  const output: RankedRecommendation[] = [];
  const outputLimit = Math.max(1, Math.min(50, requestedLimit));
  for (const track of ranked) {
    // Unknown artist metadata should not be treated as one giant artist and suppress
    // unrelated tracks. Use the track identity as its independent fallback key.
    const normalizedArtist = normalize(track.artist);
    const artistKey = normalizedArtist || `track:${track.id}`;
    const count = artistCounts.get(artistKey) ?? 0;
    if (count >= 2) continue;
    artistCounts.set(artistKey, count + 1);
    output.push(track);
    if (output.length >= outputLimit) break;
  }
  return output;
}
