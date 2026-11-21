// Shared access to SONORA's unified licensed catalog: Jamendo (non-commercial
// API client path) and the public Audius discovery/search endpoints. Used by
// the core API routes and by the import service. Network side-effects only;
// nothing here writes to the database.

import type { RecommendationTrack } from "./recommendation-core.js";

// Long Audius uploads are frequently multi-hour playlist dumps, not songs.
export const PLAYABLE_MAX_DURATION_SECONDS = 2700;

export function catalogSearchKey(value: unknown): string {
  return typeof value === "string"
    ? value.normalize("NFKC").toLowerCase().replace(/ё/g, "е").replace(/[^\p{L}\p{N}]+/gu, " ").trim()
    : "";
}

export function matchesCatalogSearch(query: string, ...fields: unknown[]): boolean {
  const key = catalogSearchKey(query);
  const words = new Set(catalogSearchKey(fields.join(" ")).split(" "));
  return key !== "" && key.split(" ").every((word) => words.has(word));
}

export function hasUncreditedArtistPrefix(queryKey: string, title: unknown): boolean {
  if (typeof title !== "string" || !queryKey) return false;
  const [prefix, recording] = title.split(/\s+[-–—]\s+/, 2);
  return Boolean(recording && catalogSearchKey(prefix) === queryKey);
}

export type JamendoCandidate = RecommendationTrack & {
  album: string | null; artworkUrl: string | null; audioUrl: string;
  licenseUrl: string; sourceUrl: string; providerTrackId: string;
  provider: string; playable: boolean;
};

// Unified Jamendo access gate: catalog is available when a client id exists and
// either non-commercial mode or commercial approval is configured. Every route
// must use these helpers so catalog listing, search, recommendations and
// verification flows share identical access semantics.
export function jamendoConfig(): { clientId: string; nonCommercial: boolean } | null {
  const clientId = process.env.JAMENDO_CLIENT_ID;
  const nonCommercial = process.env.JAMENDO_USE_MODE === "noncommercial";
  const commercialApproved = process.env.JAMENDO_COMMERCIAL_APPROVED === "true";
  if (!clientId || (!nonCommercial && !commercialApproved)) return null;
  return { clientId, nonCommercial };
}

export function jamendoLicenseAllowed(licenseUrl: string, nonCommercial: boolean): boolean {
  const normalized = licenseUrl.toLowerCase()
    .replace("http://creativecommons.org/", "")
    .replace("https://creativecommons.org/", "")
    .replace("https://www.creativecommons.org/", "");
  const slug = normalized.startsWith("licenses/") ? normalized.split("/")[1] ?? "" : "";
  const known = normalized.startsWith("publicdomain/zero/") ||
    ["by", "by-sa", "by-nd", "by-nc", "by-nc-sa", "by-nc-nd"].includes(slug);
  return known && (nonCommercial || !slug.includes("-nc"));
}

export async function jamendoCandidates(
  query: string, count: number, order = "relevance"
): Promise<JamendoCandidate[]> {
  const jamendo = jamendoConfig();
  if (!jamendo) return [];
  const clientId = jamendo.clientId;
  try {
    const params = new URLSearchParams({
      client_id: clientId, format: "json", limit: String(count), order,
      include: "licenses musicinfo", type: "single albumtrack", audioformat: "mp32"
    });
    if (query) params.set("search", query);
    else params.set("featured", "1");
    const response = await fetch(`https://api.jamendo.com/v3.0/tracks/?${params.toString()}`, {
      headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) return [];
    const payload = await response.json() as { results?: Array<{
      id: string; name: string; duration: number; artist_name: string; album_name?: string;
      image?: string; album_image?: string; audio?: string; license_ccurl?: string; shareurl?: string;
      musicinfo?: { tags?: Array<{ name: string }> };
    }> };
    return (payload.results ?? []).flatMap((track) => {
      if (!track.id || !track.audio || !jamendoLicenseAllowed(track.license_ccurl ?? "", jamendo.nonCommercial)) return [];
      return [{
        id: `jamendo:${track.id}`, providerTrackId: track.id, title: track.name,
        artist: track.artist_name, album: track.album_name ?? null,
        durationSeconds: track.duration, genres: (track.musicinfo?.tags ?? []).map((tag) => tag.name).slice(0, 5),
        artworkUrl: track.album_image ?? track.image ?? null, audioUrl: track.audio,
        licenseUrl: track.license_ccurl ?? "", sourceUrl: track.shareurl ?? `https://www.jamendo.com/track/${track.id}`,
        provider: "Jamendo", playable: true
      }];
    });
  } catch {
    return [];
  }
}

/**
 * Audius public track search, mapped to the same candidate shape. Only
 * API-streamable, non-gated, song-length items are returned — imports must
 * never attach tracks that SONORA cannot honestly play.
 */
export async function audiusCandidates(query: string, count: number): Promise<JamendoCandidate[]> {
  if (!query) return [];
  try {
    const params = new URLSearchParams({
      query, limit: String(Math.min(20, Math.max(1, Math.floor(count) || 5))), app_name: "SONORA"
    });
    const response = await fetch(`https://api.audius.co/v1/tracks/search?${params.toString()}`, {
      headers: { Accept: "application/json" }, signal: AbortSignal.timeout(9000)
    });
    if (!response.ok) return [];
    const payload = await response.json() as { data?: Array<{
      id: string; title: string; duration?: number; permalink?: string; is_streamable?: boolean;
      is_stream_gated?: boolean; license?: string; artwork?: Record<string, string> | null;
      user?: { name?: string; handle?: string }; album?: { playlist_name?: string };
    }> };
    return (payload.data ?? []).flatMap((track) => {
      if (!track.id || !track.title) return [];
      const streamable = track.is_streamable === true && track.is_stream_gated !== true &&
        (!track.duration || track.duration <= PLAYABLE_MAX_DURATION_SECONDS);
      if (!streamable) return [];
      return [{
        id: `audius:${track.id}`, providerTrackId: track.id, title: track.title,
        artist: track.user?.name ?? track.user?.handle ?? "Audius creator",
        album: track.album?.playlist_name ?? null, durationSeconds: track.duration ?? null,
        genres: [],
        artworkUrl: track.artwork?.["480x480"] ?? track.artwork?.["150x150"] ?? null,
        audioUrl: `https://api.audius.co/v1/tracks/${encodeURIComponent(track.id)}/stream?app_name=SONORA`,
        licenseUrl: typeof track.license === "string" && track.license.startsWith("http") ? track.license : "https://audius.co/terms",
        sourceUrl: track.permalink ?? "https://audius.co", provider: "Audius", playable: true
      }];
    });
  } catch {
    return [];
  }
}
