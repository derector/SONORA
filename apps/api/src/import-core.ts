// Pure, testable core of the SONORA server-side import service.
// No network access here: routes feed fetched payloads into these functions
// and persist the honest results. Matching is metadata-only against
// SONORA's licensed catalog providers (Jamendo, Audius).

import { normalize as baseNormalize } from "./recommendation-core.js";

export type ImportSourceKind =
  | "deezer" | "apple" | "spotify" | "youtube" | "yandex" | "vk"
  | "soundcloud" | "jamendo" | "file_generic" | "unknown";

export type ParsedSource = {
  kind: ImportSourceKind;
  externalId?: string;
  canonicalUrl: string;
  /** True when no free, public, keyless API exposes the per-track list. */
  needsManualExport?: boolean;
  hint?: string;
};

export type ImportListItem = { artist: string; title: string; album?: string | null };
export type ParsedList = { playlistName: string | null; items: ImportListItem[] };

const EXPORT_HINT = "Use the platform's data export (or paste the track list) and upload the file via POST /api/v1/import/file.";

function unknown(raw: unknown): ParsedSource {
  return { kind: "unknown", canonicalUrl: typeof raw === "string" ? raw.trim().slice(0, 2048) : "" };
}

/**
 * Allowlist parser for public playlist links. Only well-known, documented
 * URL shapes are accepted; everything else is honestly `unknown`. Nothing is
 * fetched here — this is pure pattern recognition with canonical URLs.
 */
export function parseSourceUrl(rawUrl: unknown): ParsedSource {
  if (typeof rawUrl !== "string") return unknown(rawUrl);
  const trimmed = rawUrl.trim().slice(0, 2048);
  if (!trimmed) return unknown(trimmed);
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return unknown(trimmed);
  }
  // Public allowlist is https-only; http is upgraded, anything else rejected.
  if (url.protocol !== "https:" && url.protocol !== "http:") return unknown(trimmed);
  url.protocol = "https:";
  url.hash = "";
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const path = url.pathname.replace(/\/+$/, "");
  let match: RegExpExecArray | null;

  if (host === "open.spotify.com") {
    match = /^\/(?:intl-[a-z]{2}(?:-[a-z]{2})?\/)?playlist\/([A-Za-z0-9]{22}|[0-9a-fA-F]{32})(?:\/.*)?$/.exec(path);
    if (match) {
      const id = match[1];
      return { kind: "spotify", externalId: id, canonicalUrl: `https://open.spotify.com/playlist/${id}`, hint: EXPORT_HINT };
    }
    return unknown(trimmed);
  }

  if (host === "music.apple.com") {
    // Real Apple Music URLs are /<cc>/playlist/<human-slug>/pl.<id> (or /p-<id>).
    match = /^\/([a-z]{2})\/playlist\/(?:[A-Za-z0-9-]+\/)?(p[A-Za-z0-9.-]{5,79})$/.exec(path);
    if (match) {
      return {
        kind: "apple", externalId: match[2],
        canonicalUrl: `https://music.apple.com/${match[1]}/playlist/${match[2]}`,
        hint: `Apple exposes playlist track lists only through a paid partner API. ${EXPORT_HINT}`
      };
    }
    return unknown(trimmed);
  }

  if (host === "music.yandex.ru" || host === "music.yandex.by" || host === "music.yandex.kz" || host === "music.yandex.com") {
    match = /^\/users\/([A-Za-z0-9@._-]{1,100})\/playlists\/(\d{1,12})$/.exec(path);
    if (match) {
      return {
        kind: "yandex", externalId: match[2],
        canonicalUrl: `https://music.yandex.ru/users/${match[1]}/playlists/${match[2]}`,
        needsManualExport: true,
        hint: `Yandex Music has no free official public API for playlist track lists (metadata-only support). ${EXPORT_HINT}`
      };
    }
    return unknown(trimmed);
  }

  if (host === "vk.com" || host === "vkvideo.ru") {
    match = /^\/playlist-(\d{1,19})_(\d{1,19})$/.exec(path);
    if (match) {
      return {
        kind: "vk", externalId: `${match[1]}_${match[2]}`,
        canonicalUrl: `https://vk.com/playlist-${match[1]}_${match[2]}`,
        needsManualExport: true,
        hint: `VK requires authenticated access for playlist contents and SONORA never uses unofficial authenticated APIs. ${EXPORT_HINT}`
      };
    }
    return unknown(trimmed);
  }

  if (host === "soundcloud.com") {
    match = /^\/([A-Za-z0-9_-]{1,64})\/sets\/([A-Za-z0-9_-]{1,64})$/.exec(path);
    if (match) {
      return {
        kind: "soundcloud", externalId: `${match[1]}/${match[2]}`,
        canonicalUrl: `https://soundcloud.com/${match[1]}/sets/${match[2]}`
      };
    }
    return unknown(trimmed);
  }

  if (host === "deezer.com") {
    match = /^\/(?:[a-z]{2}\/)?playlist\/(\d{1,19})(?:\/.*)?$/.exec(path);
    if (match) {
      return { kind: "deezer", externalId: match[1], canonicalUrl: `https://www.deezer.com/playlist/${match[1]}` };
    }
    return unknown(trimmed);
  }

  if (host === "music.youtube.com") {
    const list = url.searchParams.get("list") ?? "";
    if (/^\/playlist$/i.test(path) && /^[A-Za-z0-9_-]{10,80}$/.test(list)) {
      return {
        kind: "youtube", externalId: list,
        canonicalUrl: `https://music.youtube.com/playlist?list=${list}`,
        needsManualExport: true,
        hint: "YouTube Music has no keyless playlist API. Export via Google Takeout (YouTube Music -> playlists.csv) or paste the track list. " + EXPORT_HINT
      };
    }
    return unknown(trimmed);
  }

  if (host === "jamendo.com") {
    match = /^\/(?:en\/)?playlist\/show\/(\d{1,12})(?:\/[A-Za-z0-9_-]*)?$/.exec(path);
    if (match) {
      return { kind: "jamendo", externalId: match[1], canonicalUrl: `https://www.jamendo.com/playlist/show/${match[1]}` };
    }
    // Older Jamendo musicarchive URL family, kept on the allowlist.
    match = /^\/musicarchive\/playlist\/(\d{1,12})(?:\/[A-Za-z0-9_-]*)?$/.exec(path);
    if (match) {
      return { kind: "jamendo", externalId: match[1], canonicalUrl: `https://www.jamendo.com/playlist/show/${match[1]}` };
    }
    return unknown(trimmed);
  }

  return unknown(trimmed);
}

// ---------------------------------------------------------------------------
// Normalization shared by the matcher. Builds on recommendation-core's
// normalize (lowercase, ё→е, diacritic folding, punctuation folding).
// ---------------------------------------------------------------------------

const FEATURE_SEGMENT = /\b(?:feat|featuring|ft|vs|v\/s)\.?\s+[^([{\]/]*(?=[([{\/]|$)/gi;
const NOISE_TERMS = /\b(?:official\s+(?:video|audio)(?:\s+lyrics?)?|lyrics?\s*video|visuali[sz]er|remaster(?:ed)?(?:\s*\d{4})?|radio\s*edit|single\s*version|album\s*version|explicit)\b/gi;

/** Lowercase, fold accents/ё, strip feat/vs segments, bracketed groups and version noise, collapse whitespace. */
export function normalizeForMatch(value: unknown): string {
  if (typeof value !== "string") return "";
  let text = value;
  // Fold ё BEFORE NFKD: the precomposed Cyrillic ё would otherwise decompose
  // into е + combining stroke and leave a stray whitespace token.
  text = text.replace(/[ёЁ]/g, "е");
  text = text.replace(/[\([{][^\])}]*[\])}]/g, " "); // parenthetical noise entirely
  text = text.replace(FEATURE_SEGMENT, " ");          // "feat. X", "vs. Y" segments
  text = text.replace(NOISE_TERMS, " ");              // unbracketed version noise
  text = baseNormalize(text).replace(/\s+/g, " ").trim();
  return text;
}

function tokenSet(value: string): Set<string> {
  return new Set(value.split(" ").filter(Boolean));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared++;
  return shared / (a.size + b.size - shared);
}

/** Levenshtein-lite: two-row dynamic programming, early-exit on identical input. */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length || !b.length) return Math.max(a.length, b.length);
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    previous = current;
  }
  return previous[b.length];
}

function editSimilarity(a: string, b: string): number {
  if (!a.length && !b.length) return 1;
  const longest = Math.max(a.length, b.length);
  return 1 - editDistance(a, b) / longest;
}

export type MatchWant = { artist?: string | null; title: string; durationSeconds?: number | null };
export type MatchCandidate = { artist: string; title: string; durationSeconds?: number | null };

function artistScore(want: string, have: string): number {
  if (!want) return 0.5;                       // no artist info: neutral
  if (!have) return 0.35;                      // catalog row without artist: weak
  if (want === have) return 1;
  if (have.includes(want) || want.includes(have)) return 0.9; // containment (collabs, "&" splits)
  return jaccard(tokenSet(want), tokenSet(have));
}

/**
 * Deterministic 0..1 match score: normalized artist containment/overlap plus
 * title similarity (token Jaccard vs. Levenshtein-lite, best wins) with a
 * duration bonus/penalty within ±15 seconds of the requested length.
 */
export function scoreMatch(candidate: MatchCandidate, want: MatchWant): number {
  const wantTitle = normalizeForMatch(want.title);
  const haveTitle = normalizeForMatch(candidate.title);
  if (!wantTitle || !haveTitle) return 0;
  const a = artistScore(normalizeForMatch(want.artist ?? ""), normalizeForMatch(candidate.artist));
  let t: number;
  if (wantTitle === haveTitle) t = 1;
  else t = Math.max(jaccard(tokenSet(wantTitle), tokenSet(haveTitle)), editSimilarity(wantTitle, haveTitle));
  let score = 0.4 * a + 0.6 * t;
  const wantDuration = typeof want.durationSeconds === "number" && Number.isFinite(want.durationSeconds) ? want.durationSeconds : null;
  const haveDuration = typeof candidate.durationSeconds === "number" && Number.isFinite(candidate.durationSeconds) ? candidate.durationSeconds : null;
  if (wantDuration !== null && haveDuration !== null && wantDuration > 0 && haveDuration > 0) {
    const delta = Math.abs(wantDuration - haveDuration);
    if (delta <= 15) score += 0.05;
    else if (delta > 45) score -= 0.05;
  }
  return Math.max(0, Math.min(1, score));
}

// ---------------------------------------------------------------------------
// Uploaded export parsers
// ---------------------------------------------------------------------------

const MAX_FIELD = 300;
function cleanField(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, MAX_FIELD) : "";
}

function splitDelimited(line: string, delimiter: string): string[] {
  const values: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"' && quoted && line[i + 1] === '"') { current += '"'; i++; }
    else if (char === '"') quoted = !quoted;
    else if (char === delimiter && !quoted) { values.push(current.trim()); current = ""; }
    else current += char;
  }
  values.push(current.trim());
  return values;
}

const TITLE_HEADERS = ["track", "trackname", "track name", "title", "song", "songname", "song name", "name"];
const ARTIST_HEADERS = ["artist", "artistname", "artist name", "artists", "artist(s)", "performer", "interprete", "artistinterpretation", "by"];
const ALBUM_HEADERS = ["album", "albumname", "album name", "release"];
const PLAYLIST_HEADERS = ["playlist name", "playlist_name", "playlist", "set", "collection"];

function headerIndex(header: string[], candidates: string[]): number {
  return header.findIndex((value) => candidates.includes(value));
}

function isJunkLine(line: string): boolean {
  const text = line.trim();
  if (!text) return true;
  if (/^#/.test(text)) return true;
  if (/^https?:\/\//i.test(text)) return true;
  if (/^[\d\s.,;:-]+$/.test(text)) return true; // pure numbering/garbage
  return false;
}

/**
 * CSV/TSV (and plain "Artist - Title" line) parser with case-insensitive
 * header sniffing. Junk lines are skipped, never guessed around.
 */
export function parseGenericList(text: string): ParsedList {
  const rawLines = String(text ?? "").split(/\r?\n/);
  const lines = rawLines.filter((line) => line.trim().length > 0);
  if (!lines.length) return { playlistName: null, items: [] };
  const first = lines[0];
  const delimiter = (first.split("\t").length - 1) > (first.split(",").length - 1) ? "\t" : ",";
  const headerCells = splitDelimited(first, delimiter).map((cell) => cell.toLowerCase().replace(/^"|"$/g, "").trim());
  const titleIndex = headerIndex(headerCells, TITLE_HEADERS);
  const hasHeader = titleIndex >= 0 || headerIndex(headerCells, ARTIST_HEADERS) >= 0;

  if (hasHeader) {
    const artistIndex = headerIndex(headerCells, ARTIST_HEADERS);
    const albumIndex = headerIndex(headerCells, ALBUM_HEADERS);
    const playlistIndex = headerIndex(headerCells, PLAYLIST_HEADERS);
    const items: ImportListItem[] = [];
    let playlistName: string | null = null;
    for (const line of lines.slice(1)) {
      if (isJunkLine(line)) continue;
      const cells = splitDelimited(line, delimiter);
      const title = cleanField(cells[titleIndex]);
      if (!title) continue;
      if (playlistIndex >= 0 && !playlistName) playlistName = cleanField(cells[playlistIndex]) || null;
      items.push({ artist: artistIndex >= 0 ? cleanField(cells[artistIndex]) : "", title, album: albumIndex >= 0 ? cleanField(cells[albumIndex]) || null : null });
    }
    return { playlistName, items };
  }

  // Headerless plain text: one track per line, optionally "Artist - Title".
  const items: ImportListItem[] = [];
  for (const line of lines) {
    if (isJunkLine(line)) continue;
    const cleaned = line.replace(/https?:\/\/\S+/gi, "").replace(/^[-*•\d.\s]+/, "").trim();
    if (!cleaned) continue;
    const split = cleaned.split(/\s+[–—-]\s+/);
    if (split.length >= 2 && split[0].trim() && split.slice(1).join(" - ").trim()) {
      items.push({ artist: cleanField(split[0]), title: cleanField(split.slice(1).join(" - ")), album: null });
    } else {
      items.push({ artist: "", title: cleanField(cleaned), album: null });
    }
  }
  return { playlistName: null, items };
}

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };

function asObject(value: JsonValue | undefined): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}
function asArray(value: JsonValue | undefined): JsonValue[] {
  return Array.isArray(value) ? value : [];
}
function asString(value: JsonValue | undefined): string {
  return typeof value === "string" ? value : "";
}

/**
 * Spotify privacy-export JSON (`{"Playlists":[...]}`) and the newer
 * (`{"playlists":[...]}`) shape. Returns one ParsedList per playlist;
 * unrecognized shapes yield an empty array so routes can report honestly.
 */
export function parseSpotifyExportJson(text: string): ParsedList[] {
  let payload: JsonObject;
  try {
    const parsed = JSON.parse(String(text)) as JsonValue;
    payload = asObject(parsed) ?? {};
  } catch {
    return [];
  }
  const result: ParsedList[] = [];

  // Shape A: {"Playlists":[{"name","tracks":{"Items":[{"TrackUri","Artist","TrackName","AlbumName"}]}}]}
  for (const entry of asArray(payload["Playlists"])) {
    const playlist = asObject(entry);
    if (!playlist) continue;
    const tracks = asArray(asObject(playlist["tracks"])?.["Items"]);
    const items: ImportListItem[] = [];
    for (const rawTrack of tracks) {
      const track = asObject(rawTrack);
      if (!track) continue;
      const title = cleanField(asString(track["TrackName"]));
      if (!title) continue;
      items.push({ artist: cleanField(asString(track["Artist"])), title, album: cleanField(asString(track["AlbumName"])) || null });
    }
    result.push({ playlistName: cleanField(asString(playlist["name"])) || "Spotify export", items });
  }

  // Shape B: {"playlists":[{"name","tracks":[{"track":{"name","artists":[{"name"}],"album":{"name"}}}]}]}
  for (const entry of asArray(payload["playlists"])) {
    const playlist = asObject(entry);
    if (!playlist) continue;
    const items: ImportListItem[] = [];
    for (const rawEntry of asArray(playlist["tracks"])) {
      const track = asObject(asObject(rawEntry)?.["track"]) ?? asObject(rawEntry);
      if (!track) continue;
      const title = cleanField(asString(track["name"]));
      if (!title) continue;
      const artist = asArray(track["artists"]).flatMap((rawArtist) => {
        const artistObject = asObject(rawArtist);
        return artistObject ? [cleanField(asString(artistObject["name"]))] : [];
      }).filter(Boolean).join(", ");
      items.push({ artist, title, album: cleanField(asString(asObject(track["album"])?.["name"])) || null });
    }
    result.push({ playlistName: cleanField(asString(playlist["name"])) || "Spotify export", items });
  }

  return result;
}
