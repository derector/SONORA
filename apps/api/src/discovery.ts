// SONORA Universal Music Discovery & Import Engine.
//
// Legal boundary (docs/UNIVERSAL_SEARCH_AND_IMPORT_RESEARCH.md section 6 and
// docs/MUSIC_PLATFORM_ARCHITECTURE.md "Compliance"): no DRM bypass, no paywall
// or auth-wall scraping, no extraction of protected full audio. Every adapter
// declares a per-result access status:
//   open        — licensed full audio SONORA may stream (CC/PD catalogs,
//                 Jamendo, Audius public streams, Internet Archive, Openverse,
//                 ccMixter).
//   preview     — official short preview where the provider permits this use.
//   stream_only — playable only through the source's official player/embed.
//   external    — we may only link to the source page.
//   metadata    — identifiers/credits only, no audio at all.
// An adapter must NEVER surface an audio URL that is not openly licensed and
// must never construct a full-track URL for commercial platforms.

import type { FastifyInstance, FastifyRequest } from "fastify";
import { createPrivateKey, createSign } from "node:crypto";
import {
  jamendoCandidates, jamendoConfig, PLAYABLE_MAX_DURATION_SECONDS
} from "./catalog.js";
import { normalizeForMatch, scoreMatch, type ImportListItem } from "./import-core.js";
import type { JamendoCandidate } from "./catalog.js";

export type AccessStatus = "open" | "preview" | "stream_only" | "external" | "metadata";

export type VersionTag =
  | "original" | "remix" | "live" | "instrumental" | "acoustic"
  | "speed_up" | "slowed" | "nightcore" | "edit" | null;

export type DiscoveryResult = {
  sourceId: string;
  externalId: string;
  title: string;
  artist: string;
  album?: string | null;
  durationSeconds?: number | null;
  artworkUrl?: string | null;
  audioUrl?: string | null;
  previewUrl?: string | null;
  sourcePageUrl: string;
  licenseUrl?: string | null;
  access: AccessStatus;
  isrc?: string | null;
  releaseYear?: number | null;
  versionTag?: VersionTag;
};

export type DiscoverySearchOptions = { limit: number; signal?: AbortSignal };

/** Neutral internal labels: no platform marketing names leak into the UI. */
export interface SourceAdapter {
  id: string;
  label: string;
  search(query: string, opts: DiscoverySearchOptions): Promise<DiscoveryResult[]>;
  available(env: NodeJS.ProcessEnv): boolean;
}

export const ACCESS_RANK: Record<AccessStatus, number> = {
  open: 0, preview: 1, stream_only: 2, external: 3, metadata: 4
};

const ISRC_PATTERN = /^[A-Z]{2}[A-Z0-9]{3}\d{2}\d{5}$/;
export function validIsrc(value: unknown): string | null {
  const text = typeof value === "string" ? value.toUpperCase().replace(/[\s-]/g, "") : "";
  return ISRC_PATTERN.test(text) ? text : null;
}

function clampLimit(value: unknown, fallback: number, max = 40): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(max, Math.floor(parsed));
}

// Small fetch wrapper so every adapter shares timeout + JSON discipline.
async function fetchJson<T>(url: string, timeoutMs: number, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { Accept: "application/json", ...(init?.headers ?? {}) },
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return await response.json() as T;
}

// ---------------------------------------------------------------------------
// Version tag classifier (pure, unit-testable)
// ---------------------------------------------------------------------------

const VERSION_PATTERNS: Array<[VersionTag, RegExp]> = [
  ["nightcore", /night\s*core|night\s*style|найткор|nightcore/i],
  ["speed_up", /speed\s*-?\s*up|sped\s*up|\bspeeded\b|\bsped\s?up\b|спид\s*ап|ускоренн|повышенн?ой\s*скорост/i],
  ["slowed", /sl\+wed|slowed|slow\s*(?:ed)?\s*(?:\+|and)?\s*reverb|slowed\s*version|sl0wed|замедленн|слоу(?:д|э|н)?/i],
  ["live", /\blive\b|live\s*(?:version|set|performance|at|in\s|acoustic|concert)|unplugged|концерт|live\s*\|?\s*(?:tour|show)|живая\s*версия/i],
  ["acoustic", /acoustic|неэлектрич|акустическ|акустика|guitar\s*version|piano\s*version|voiceline/i],
  ["instrumental", /instrumental|\binst\b|karaoke|\bminus(?:ovka)?\b|инструментал|минус(овка)?|backing\s*track/i],
  ["remix", /\bremix\b|remaster(?:ed)?\s*remix|\bvip\b|bootleg|refix|extended\s*mix|клубн|ремикс|ре-?микс|\bmashup\b/i],
  ["edit", /\bedit\b|re-?edit|reedition|remake|\brework\b|cut\b|version|редакция|ремейк/i],
  ["original", /original(?:\s*(?:mix|version|song|recording|take))?|оригинальн|оригинальная\s*версия|оригинал/i]
];

/**
 * Classify a recording title into a version tag. Returns null when the title
 * carries no explicit version marker (NOT "original" — silence means unknown).
 * Priority is most-specific-first: nightcore/speed/slowed family beats live,
 * acoustic and instrumental beats remix, and "original (mix|version)" is only
 * set when the title says so explicitly.
 */
export function classifyVersionTag(rawTitle: unknown): VersionTag {
  const title = typeof rawTitle === "string" ? rawTitle : "";
  if (!title.trim()) return null;
  for (const [tag, pattern] of VERSION_PATTERNS) if (pattern.test(title)) return tag;
  return null;
}

const VERSION_NOISE_IN_KEY = /\b(?:remix|live|acoustic|instrumental|karaoke|vip|bootleg|mashup|nightcore|slowed|sped|speed|edit|version|original|cover|remake|rework)\b/gi;

/** Group key without version noise so "Song (Remix)" merges with "Song". */
function versionlessKeyArtistTitle(result: DiscoveryResult): string {
  const title = normalizeForMatch(result.title).replace(VERSION_NOISE_IN_KEY, " ").replace(/\s+/g, " ").trim();
  const artist = normalizeForMatch(result.artist);
  return `mt:${artist}|${title}`;
}

function groupKeyOf(result: DiscoveryResult): string {
  const isrc = validIsrc(result.isrc);
  if (isrc) return `isrc:${isrc}`;
  return versionlessKeyArtistTitle(result);
}

// ---------------------------------------------------------------------------
// Merging / dedupe / grouping (pure, unit-testable)
// ---------------------------------------------------------------------------

export type DiscoveryGroup = {
  key: string;
  title: string;
  artist: string;
  versions: Exclude<VersionTag, null>[];
  best: DiscoveryResult;
  alternatives: DiscoveryResult[];
  isrc?: string | null;
  duration_conflict?: boolean;
};

const DURATION_SPLIT_WINDOW_SECONDS = 10;

function byAccessThenSource(a: DiscoveryResult, b: DiscoveryResult): number {
  const rank = ACCESS_RANK[a.access] - ACCESS_RANK[b.access];
  return rank !== 0 ? rank : a.sourceId.localeCompare(b.sourceId);
}

/**
 * Dedupe/fold results into groups:
 *  - key = ISRC when present, else normalized artist+title with version noise
 *    stripped, so official/remix/slowed variants merge into one group;
 *  - within a group, members whose known durations differ by more than ±10s
 *    from the group anchor split into separate groups (a wrong-ISRC merge of
 *    different recordings must not present one as an alternative of the other);
 *    a split marks `duration_conflict` so the UI can show a caution;
 *  - `best` is chosen by access order open > preview > stream_only > external
 *    > metadata, alternatives keep the same ranking.
 */
export function groupDiscoveryResults(results: DiscoveryResult[]): DiscoveryGroup[] {
  const byBase = new Map<string, DiscoveryResult[]>();
  for (const result of results) {
    const key = groupKeyOf(result);
    const bucket = byBase.get(key);
    if (bucket) bucket.push(result); else byBase.set(key, [result]);
  }
  const groups: DiscoveryGroup[] = [];
  for (const [key, members] of byBase) {
    members.sort(byAccessThenSource);
    const subgroups: Array<{ anchor: number | null; items: DiscoveryResult[] }> = [];
    for (const member of members) {
      const duration = typeof member.durationSeconds === "number" && member.durationSeconds > 0
        ? Math.round(member.durationSeconds) : null;
      let placed = false;
      for (const subgroup of subgroups) {
        if (subgroup.anchor === null || duration === null ||
            Math.abs(subgroup.anchor - duration) <= DURATION_SPLIT_WINDOW_SECONDS) {
          subgroup.items.push(member);
          if (subgroup.anchor === null && duration !== null) subgroup.anchor = duration;
          placed = true;
          break;
        }
      }
      if (!placed) subgroups.push({ anchor: duration, items: [member] });
    }
    const conflict = subgroups.length > 1;
    subgroups.forEach((subgroup, index) => {
      const [best, ...alternatives] = subgroup.items.sort(byAccessThenSource);
      if (!best) return;
      const versions: Exclude<VersionTag, null>[] = [];
      for (const item of subgroup.items) {
        if (item.versionTag && !versions.includes(item.versionTag)) versions.push(item.versionTag);
      }
      groups.push({
        key: conflict ? `${key}#d${index + 1}` : key,
        title: best.title,
        artist: best.artist,
        versions,
        best,
        alternatives,
        isrc: validIsrc(best.isrc) ?? validIsrc(alternatives.find((item) => validIsrc(item.isrc))?.isrc) ?? null,
        ...(conflict ? { duration_conflict: true } : {})
      });
    });
  }
  groups.sort((a, b) => ACCESS_RANK[a.best.access] - ACCESS_RANK[b.best.access] ||
    a.title.localeCompare(b.title));
  return groups;
}

// ---------------------------------------------------------------------------
// Shared license helpers
// ---------------------------------------------------------------------------

const OPEN_LICENSE = /creativecommons\.org\/(licenses\/|publicdomain\/)|publicdomain\.org|\/pd\/?$|\bpdm?\b|open\s*definition/i;

function isOpenLicenseUrl(value: unknown): boolean {
  return typeof value === "string" && value.startsWith("http") && OPEN_LICENSE.test(value);
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (Array.isArray(value)) {
      const nested = firstString(...value);
      if (nested) return nested;
    }
  }
  return null;
}

function finiteNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function yearOf(value: unknown): number | null {
  if (typeof value === "number" && value >= 1000 && value <= 2999) return Math.floor(value);
  const text = typeof value === "string" ? value : "";
  const match = /\b(1[0-9]{3}|20[0-9]{2})\b/.exec(text);
  return match ? Number(match[1]) : null;
}

// ---------------------------------------------------------------------------
// Adapter: independent_collection (Jamendo) — access 'open'
// ---------------------------------------------------------------------------

const jamendoCollectionAdapter: SourceAdapter = {
  id: "independent_collection",
  label: "independent_collection",
  available: () => jamendoConfig() !== null,
  async search(query, { limit }) {
    // Reuses the unified Jamendo gate + normalizer from catalog.ts untouched.
    const candidates = await jamendoCandidates(query, limit);
    return candidates.map((track) => ({
      sourceId: this.id,
      externalId: track.providerTrackId,
      title: track.title,
      artist: track.artist,
      album: track.album ?? null,
      durationSeconds: track.durationSeconds ?? null,
      artworkUrl: track.artworkUrl ?? null,
      audioUrl: track.audioUrl,          // CC-licensed full audio, allowed
      previewUrl: null,
      sourcePageUrl: track.sourceUrl,
      licenseUrl: track.licenseUrl || null,
      access: "open" as const,
      isrc: null,
      releaseYear: null,
      versionTag: classifyVersionTag(track.title)
    }));
  }
};

// ---------------------------------------------------------------------------
// Adapter: platform_stream_catalog (Audius) — 'open' for streamable uploads,
// 'external' for gated/unknown ones. Mirrors catalog.ts audiusCandidates
// because that helper intentionally drops non-streamable items; this engine
// must still SEE them as link-only external results (never surfacing audio).
// ---------------------------------------------------------------------------

const audiusPlatformAdapter: SourceAdapter = {
  id: "platform_stream_catalog",
  label: "platform_stream_catalog",
  available: () => true,
  async search(query, { limit }) {
    if (!query.trim()) return [];
    const params = new URLSearchParams({
      query, limit: String(Math.min(20, limit)), app_name: "SONORA"
    });
    const payload = await fetchJson<{ data?: Array<{
      id: string; title: string; duration?: number; permalink?: string; is_streamable?: boolean;
      is_stream_gated?: boolean; license?: string; artwork?: Record<string, string> | null;
      user?: { name?: string; handle?: string }; album?: { playlist_name?: string };
    }> }>(`https://api.audius.co/v1/tracks/search?${params.toString()}`, 9000);
    return (payload.data ?? []).flatMap((track) => {
      if (!track.id || !track.title) return [];
      const artist = track.user?.name ?? track.user?.handle ?? "Audius creator";
      const streamable = track.is_streamable === true && track.is_stream_gated !== true &&
        (!track.duration || track.duration <= PLAYABLE_MAX_DURATION_SECONDS);
      const artworkUrl = track.artwork?.["480x480"] ?? track.artwork?.["150x150"] ?? null;
      const licenseUrl = typeof track.license === "string" && track.license.startsWith("http")
        ? track.license : null;
      return [{
        sourceId: this.id,
        externalId: track.id,
        title: track.title,
        artist,
        album: track.album?.playlist_name ?? null,
        durationSeconds: track.duration ?? null,
        artworkUrl,
        // Only openly streamable tracks ever get an audio URL, same URL
        // pattern as catalog.ts; gated items stay link-only.
        audioUrl: streamable
          ? `https://api.audius.co/v1/tracks/${encodeURIComponent(track.id)}/stream?app_name=SONORA`
          : null,
        previewUrl: null,
        sourcePageUrl: track.permalink ?? "https://audius.co",
        licenseUrl,
        access: streamable ? "open" as const : "external" as const,
        isrc: null,
        releaseYear: null,
        versionTag: classifyVersionTag(track.title)
      }];
    });
  }
};

// ---------------------------------------------------------------------------
// Adapter: open_archive (Internet Archive) — CC/PD items become 'open',
// everything else is link-only 'external'. Metadata lookups are capped to
// the first 6 items per call with an 8s budget each.
// ---------------------------------------------------------------------------

type ArchiveDoc = { identifier: string; title?: string | string[]; creator?: string | string[]; year?: string | number; licenseurl?: string | string[] };

const ARCHIVE_FORMAT_ORDER = ["128kbps MP3", "VBR MP3", "MP3", "FLAC"];

const openArchiveAdapter: SourceAdapter = {
  id: "open_archive",
  label: "open_archive",
  available: () => true,
  async search(query, { limit }) {
    if (!query.trim()) return [];
    const terms = query.replace(/[()"{}[\]^~:*?\\]/g, " ").replace(/\s+/g, " ").trim();
    const fl = ["identifier", "title", "creator", "year", "licenseurl"];
    const buildUrl = (filter: string) => {
      const params = new URLSearchParams({
        q: `${filter} AND ${terms}`, rows: String(Math.min(12, Math.max(4, Math.ceil(limit / 2)))),
        page: "1", output: "json"
      });
      for (const field of fl) params.append("fl[]", field);
      return `https://archive.org/advancedsearch.php?${params.toString()}`;
    };
    let docs: ArchiveDoc[] = [];
    try {
      const primary = await fetchJson<{ response?: { docs?: ArchiveDoc[] } }>(buildUrl("collection:(audio)"), 8000);
      docs = primary.response?.docs ?? [];
      if (docs.length === 0) {
        // The 'audio' collection is narrow; mediatype covers the full audio corpus.
        const fallback = await fetchJson<{ response?: { docs?: ArchiveDoc[] } }>(buildUrl("mediatype:(audio)"), 8000);
        docs = fallback.response?.docs ?? [];
      }
    } catch {
      return [];
    }
    const detailed = await Promise.allSettled(docs.slice(0, 6).map(async (doc): Promise<DiscoveryResult[]> => {
      const meta = await fetchJson<{
        metadata?: { licenseurl?: string };
        files?: Array<{ name?: string; format?: string; title?: string; length?: string }>;
      }>(`https://archive.org/metadata/${encodeURIComponent(doc.identifier)}`, 8000);
      const itemLicense = firstString(doc.licenseurl, meta.metadata?.licenseurl) ?? "";
      const licensed = isOpenLicenseUrl(itemLicense);
      const ordered = (meta.files ?? [])
        .filter((file) => file.name && /\.(mp3|flac)$/i.test(file.name))
        .sort((a, b) => {
          const ra = ARCHIVE_FORMAT_ORDER.indexOf(String(a.format)); 
          const rb = ARCHIVE_FORMAT_ORDER.indexOf(String(b.format));
          return (ra < 0 ? 99 : ra) - (rb < 0 ? 99 : rb);
        });
      const title = firstString(doc.title) ?? doc.identifier;
      const artist = firstString(doc.creator) ?? "Internet Archive contributor";
      const year = yearOf(doc.year);
      const files = licensed ? ordered.slice(0, 3) : [];
      const pageUrl = `https://archive.org/details/${encodeURIComponent(doc.identifier)}`;
      if (files.length === 0) {
        // No open license (or no playable files) → link to the page only.
        return [{
          sourceId: this.id, externalId: doc.identifier, title, artist, album: null,
          durationSeconds: null, artworkUrl: null, audioUrl: null, previewUrl: null,
          sourcePageUrl: pageUrl,
          licenseUrl: itemLicense.startsWith("http") ? itemLicense : null,
          access: "external" as const, isrc: null, releaseYear: year,
          versionTag: classifyVersionTag(title)
        }];
      }
      return files.map((file) => {
        const fileTitle = firstString(file.title) ?? title;
        return {
          sourceId: this.id,
          externalId: `${doc.identifier}/${String(file.name)}`,
          title: fileTitle,
          artist,
          album: title === fileTitle ? null : title,
          durationSeconds: finiteNumber(file.length),
          artworkUrl: null,
          // audio.org/download serves the licensed file directly; only set
          // when the item's licenseurl/gradient matched CC*/PD*.
          audioUrl: `https://archive.org/download/${encodeURIComponent(doc.identifier)}/${String(file.name).split("/").map(encodeURIComponent).join("/")}`,
          previewUrl: null,
          sourcePageUrl: pageUrl,
          licenseUrl: itemLicense,
          access: "open" as const,
          isrc: null,
          releaseYear: year,
          versionTag: classifyVersionTag(fileTitle)
        } satisfies DiscoveryResult;
      });
    }));
    return detailed.flatMap((entry) => entry.status === "fulfilled" ? entry.value : []);
  }
};

// ---------------------------------------------------------------------------
// Adapter: open_license_index (Openverse) — only results carrying a valid
// license + audio URL; the 'url' field is the official CC stream, the source
// page comes from foreign_landing_url.
// ---------------------------------------------------------------------------

const OPENVERSE_LICENSES = new Set(["by", "by-sa", "by-nc", "by-nd", "by-nc-sa", "by-nc-nd", "pdm", "zero"]);

const openverseAudioAdapter: SourceAdapter = {
  id: "open_license_index",
  label: "open_license_index",
  available: () => true,
  async search(query, { limit }) {
    if (!query.trim()) return [];
    const params = new URLSearchParams({ q: query, page_size: String(Math.min(20, limit)) });
    const payload = await fetchJson<{ results?: Array<{
      id: string; title?: string; creator?: string; url?: string; foreign_landing_url?: string;
      license?: string; license_url?: string; duration?: number; thumbnail?: string;
      filetype?: string; nsfw?: boolean;
    }> }>(`https://api.openverse.org/v1/audio/?${params.toString()}`, 8500);
    return (payload.results ?? []).flatMap((item) => {
      const license = String(item.license ?? "").toLowerCase();
      // Valid license + reachable audio URL is the hard requirement here.
      if (!item.url || !OPENVERSE_LICENSES.has(license) || !isOpenLicenseUrl(item.license_url)) return [];
      return [{
        sourceId: this.id,
        externalId: item.id,
        title: firstString(item.title) ?? "Untitled",
        artist: firstString(item.creator) ?? "Openverse contributor",
        album: null,
        durationSeconds: item.duration ? Math.round(item.duration / 1000) : null, // API returns ms
        artworkUrl: item.thumbnail ?? null,
        audioUrl: item.url,
        previewUrl: null,
        sourcePageUrl: item.foreign_landing_url ?? "",
        licenseUrl: item.license_url ?? null,
        access: "open" as const,
        isrc: null,
        releaseYear: null,
        versionTag: classifyVersionTag(item.title)
      } satisfies DiscoveryResult];
    });
  }
};

// ---------------------------------------------------------------------------
// Adapter: open_remix_archive (ccMixter) — community remixes under explicit
// Creative Commons licenses; download_url is served by ccmixter itself.
// ---------------------------------------------------------------------------

async function ccMixterFetch(url: string, timeoutMs: number): Promise<unknown> {
  // ccMixter occasionally truncates large chunked responses; retry once.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await fetchJson<unknown>(url, timeoutMs);
    } catch (error) {
      if (attempt === 1) throw error;
    }
  }
  return [];
}

const ccMixterAdapter: SourceAdapter = {
  id: "open_remix_archive",
  label: "open_remix_archive",
  available: () => true,
  async search(query, { limit }) {
    if (!query.trim()) return [];
    const params = new URLSearchParams({
      search_tags: query, limit: String(Math.min(20, limit)), sort: "favs", format: "json"
    });
    const payload = await ccMixterFetch(
      `https://ccmixter.org/api/query?${params.toString()}`, 8500
    ) as Array<{
      upload_id?: number; upload_name?: string; user_name?: string; user_real_name?: string;
      license_url?: string; license_name?: string; file_page_url?: string;
      upload_date_format?: string;
      upload_extra?: { nsfw?: boolean };
      files?: Array<{ file_nicname?: string; download_url?: string; file_format_info?: { ps?: string; "media-type"?: string } }>;
    }>;
    return payload.flatMap((item) => {
      if (!item.upload_id || !item.upload_name || item.upload_extra?.nsfw === true) return [];
      if (!isOpenLicenseUrl(item.license_url)) return []; // every ccMixter license is CC; keep the gate explicit
      const mp3 = (item.files ?? []).find((file) =>
        file.download_url?.startsWith("https://") && file.file_nicname === "mp3" &&
        file.file_format_info?.["media-type"] === "audio");
      // "5:23" playtime → seconds.
      const ps = mp3?.file_format_info?.ps ?? "";
      const parts = ps.split(":").map(Number);
      const duration = parts.length === 2 && parts.every(Number.isFinite)
        ? parts[0] * 60 + parts[1] : parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : null;
      return [{
        sourceId: this.id,
        externalId: String(item.upload_id),
        title: item.upload_name,
        artist: firstString(item.user_name) ?? "ccMixter artist",
        album: null,
        durationSeconds: duration,
        artworkUrl: null,
        audioUrl: mp3?.download_url ?? null,
        previewUrl: null,
        sourcePageUrl: item.file_page_url ?? `https://ccmixter.org/files/${item.user_name}/${item.upload_id}`,
        licenseUrl: item.license_url ?? null,
        access: mp3?.download_url ? "open" as const : "external" as const,
        isrc: null,
        releaseYear: yearOf(item.upload_date_format),
        versionTag: classifyVersionTag(item.upload_name)
      } satisfies DiscoveryResult];
    });
  }
};

// ---------------------------------------------------------------------------
// Adapter: platform_preview (Apple iTunes Search API) — public, keyless, and
// official: the API's own previewUrl is the maximum we ever expose. We NEVER
// construct full-track stream URLs from the trackId; iTunes assets are DRM
// protected outside their own clients.
// ---------------------------------------------------------------------------

const applePreviewsAdapter: SourceAdapter = {
  id: "platform_preview",
  label: "platform_preview",
  available: () => true,
  async search(query, { limit }) {
    if (!query.trim()) return [];
    const params = new URLSearchParams({
      term: query, media: "music", entity: "song", limit: String(Math.min(25, Math.max(5, limit)))
    });
    const payload = await fetchJson<{ resultCount?: number; results?: Array<{
      trackId?: number; trackName?: string; artistName?: string; collectionName?: string;
      artworkUrl100?: string; previewUrl?: string; trackTimeMillis?: number;
      trackViewUrl?: string; isrc?: string; releaseDate?: string;
    }> }>(`https://itunes.apple.com/search?${params.toString()}`, 8000);
    return (payload.results ?? []).flatMap((item) => {
      if (!item.trackId || !item.trackName) return [];
      const preview = item.previewUrl && item.previewUrl.startsWith("https://") ? item.previewUrl : null;
      return [{
        sourceId: this.id,
        externalId: String(item.trackId),
        title: item.trackName,
        artist: firstString(item.artistName) ?? "Unknown artist",
        album: item.collectionName ?? null,
        durationSeconds: item.trackTimeMillis ? Math.round(item.trackTimeMillis / 1000) : null,
        // 100x100bb → 600x600bb is Apple's documented artwork size swap.
        artworkUrl: item.artworkUrl100 ? item.artworkUrl100.replace(/\/100x100bb\.jpg$/, "/600x600bb.jpg") : null,
        audioUrl: null,               // full audio is never exposed here
        previewUrl: preview,
        sourcePageUrl: item.trackViewUrl ?? `https://itunes.apple.com/us/song/id${item.trackId}`,
        licenseUrl: null,             // platform terms, not an open license
        access: preview ? "preview" as const : "external" as const,
        isrc: validIsrc(item.isrc),
        releaseYear: yearOf(item.releaseDate),
        versionTag: classifyVersionTag(item.trackName)
      } satisfies DiscoveryResult];
    });
  }
};

// ---------------------------------------------------------------------------
// Adapter: metadata_graph (MusicBrainz) — pure metadata enrichment for
// matching (ISRC + credits). No audio at all, ever.
// ---------------------------------------------------------------------------

const MB_HEADERS = { "User-Agent": "SONORA/0.2 (music discovery app; https://github.com/derector/SONORA)" };

const metadataGraphAdapter: SourceAdapter = {
  id: "metadata_graph",
  label: "metadata_graph",
  available: () => true,
  async search(query, { limit }) {
    if (!query.trim()) return [];
    const isrc = validIsrc(query);
    const params = new URLSearchParams({
      query: isrc ? `isrc:${isrc}` : query, fmt: "json",
      limit: String(Math.min(25, limit)), inc: "isrcs"
    });
    const payload = await fetchJson<{ recordings?: Array<{
      id: string; title?: string; length?: number; isrcs?: string[];
      "artist-credit"?: Array<{ name?: string; artist?: { name?: string } }>;
      releases?: Array<{ title?: string }>;
    }> }>(`https://musicbrainz.org/ws/2/recording/?${params.toString()}`, 8500, { headers: MB_HEADERS });
    return (payload.recordings ?? []).flatMap((recording) => {
      if (!recording.id || !recording.title) return [];
      return [{
        sourceId: this.id,
        externalId: recording.id,
        title: recording.title,
        artist: (recording["artist-credit"] ?? [])
          .map((credit) => credit.name ?? credit.artist?.name ?? "").filter(Boolean).join(" ") || "Unknown artist",
        album: recording.releases?.[0]?.title ?? null,
        durationSeconds: recording.length ? Math.round(recording.length / 1000) : null,
        artworkUrl: null,
        audioUrl: null,
        previewUrl: null,
        sourcePageUrl: `https://musicbrainz.org/recording/${recording.id}`,
        licenseUrl: null,
        access: "metadata" as const,
        isrc: validIsrc((recording.isrcs ?? [])[0]),
        releaseYear: null,
        versionTag: classifyVersionTag(recording.title)
      } satisfies DiscoveryResult];
    });
  }
};

// ---------------------------------------------------------------------------
// Key-gated platform adapters. All of them are link/preview-only: SONORA
// never requests, constructs or surfaces full commercial audio here. They
// stay dark (available()=false) until the operator supplies official API
// credentials.
// ---------------------------------------------------------------------------

// Spotify client-credentials token cache (module scope, per client id).
const spotifyTokens = new Map<string, { token: string; expiresAt: number }>();

async function spotifyAccessToken(clientId: string, clientSecret: string): Promise<string> {
  const cacheKey = clientId;
  const cached = spotifyTokens.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 30000) return cached.token;
  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) throw new Error(`Spotify auth HTTP ${response.status}`);
  const payload = await response.json() as { access_token?: string; expires_in?: number };
  if (!payload.access_token) throw new Error("Spotify auth returned no token");
  spotifyTokens.set(cacheKey, {
    token: payload.access_token,
    expiresAt: Date.now() + Math.max(60, (payload.expires_in ?? 3600) - 120) * 1000
  });
  return payload.access_token;
}

const spotifySearchAdapter: SourceAdapter = {
  id: "commercial_streaming",
  label: "commercial_streaming",
  available: (env) => Boolean(env.SPOTIFY_CLIENT_ID && env.SPOTIFY_CLIENT_SECRET &&
    /^[A-Z]{2}$/.test(env.SPOTIFY_CATALOG_MARKET ?? "")),
  async search(query, { limit }) {
    const clientId = process.env.SPOTIFY_CLIENT_ID ?? "";
    const secret = process.env.SPOTIFY_CLIENT_SECRET ?? "";
    const token = await spotifyAccessToken(clientId, secret);
    const params = new URLSearchParams({
      q: query, type: "track", limit: String(Math.min(10, limit)), market: process.env.SPOTIFY_CATALOG_MARKET ?? ""
    });
    const payload = await fetchJson<{ tracks?: { items?: Array<{
      id: string; name: string; duration_ms?: number;
      artists?: Array<{ name?: string }>;
      album?: { name?: string; release_date?: string; images?: Array<{ url?: string }> };
      external_ids?: { isrc?: string };
    }> } }>(`https://api.spotify.com/v1/search?${params.toString()}`, 8000, {
      headers: { Authorization: `Bearer ${token}` }
    });
    return (payload.tracks?.items ?? []).flatMap((track) => {
      if (!track.id || !track.name) return [];
      return [{
        sourceId: this.id, externalId: track.id, title: track.name,
        artist: (track.artists ?? []).map((a) => a.name).filter(Boolean).join(", ") || "Unknown artist",
        album: track.album?.name ?? null,
        durationSeconds: track.duration_ms ? Math.round(track.duration_ms / 1000) : null,
        artworkUrl: track.album?.images?.[0]?.url ?? null,
        audioUrl: null, previewUrl: null,
        sourcePageUrl: `https://open.spotify.com/track/${encodeURIComponent(track.id)}`,
        licenseUrl: null,
        access: "external" as const,
        isrc: validIsrc(track.external_ids?.isrc), releaseYear: yearOf(track.album?.release_date),
        versionTag: classifyVersionTag(track.name)
      } satisfies DiscoveryResult];
    });
  }
};

// Deezer official public JSON search (gated by DEEZER_APP_ID for operator
// control; no credentials are technically required by the endpoint).
const deezerSearchAdapter: SourceAdapter = {
  id: "deezer_public_catalog",
  label: "deezer_public_catalog",
  available: (env) => Boolean(env.DEEZER_APP_ID),
  async search(query, { limit }) {
    const params = new URLSearchParams({ q: query, limit: String(Math.min(25, limit)) });
    const appId = process.env.DEEZER_APP_ID;
    if (appId) params.set("app_id", appId);
    const payload = await fetchJson<{ data?: Array<{
      id: number; title?: string; title_short?: string; artist?: { name?: string };
      album?: { title?: string; cover_xl?: string; cover_medium?: string };
      duration?: number; preview?: string; link?: string; isrc?: string;
    }> }>(`https://api.deezer.com/search/track?${params.toString()}`, 8000);
    return (payload.data ?? []).flatMap((track) => {
      if (!track.id || !track.title) return [];
      const preview = track.preview?.startsWith("https://") ? track.preview : null;
      return [{
        sourceId: this.id, externalId: String(track.id), title: track.title,
        artist: firstString(track.artist?.name) ?? "Unknown artist",
        album: track.album?.title ?? null,
        durationSeconds: track.duration ?? null,
        artworkUrl: track.album?.cover_xl ?? track.album?.cover_medium ?? null,
        audioUrl: null,                       // full Deezer audio is DRM territory
        previewUrl: preview,                  // official 30s preview only
        sourcePageUrl: track.link ?? `https://www.deezer.com/track/${track.id}`,
        licenseUrl: null,
        access: preview ? "preview" as const : "external" as const,
        isrc: validIsrc(track.isrc), releaseYear: null,
        versionTag: classifyVersionTag(track.title)
      } satisfies DiscoveryResult];
    });
  }
};

// Apple Music catalog search via a signed MusicKit developer token (ES256).
// Requires APPLE_MUSIC_TEAM_ID + APPLE_MUSIC_KEY_ID + APPLE_MUSIC_PRIVATE_KEY.
const appleMusicTokens = new Map<string, { token: string; expiresAt: number }>();

function base64url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

function derSignatureToJose(der: Buffer): Buffer {
  // ASN.1 SEQUENCE { INTEGER r, INTEGER s } → fixed-width JOSE r||s (32 bytes each).
  const readInteger = (start: number): { value: Buffer; next: number } => {
    if (der[start] !== 0x02) throw new Error("bad ECDSA signature encoding");
    const length = der[start + 1];
    let bytes = der.subarray(start + 2, start + 2 + length);
    while (bytes.length > 1 && bytes[0] === 0x00) bytes = bytes.subarray(1);
    if (bytes.length > 32) bytes = bytes.subarray(0, 32);
    return { value: Buffer.concat([Buffer.alloc(32 - bytes.length), bytes]), next: start + 2 + length };
  };
  if (der[0] !== 0x30) throw new Error("bad ECDSA signature encoding");
  const r = readInteger(2);
  const s = readInteger(r.next);
  return Buffer.concat([r.value, s.value.subarray(0, 32)]);
}

function appleMusicDeveloperToken(env: NodeJS.ProcessEnv): { token: string; expiresAt: number } {
  const cacheKey = `${env.APPLE_MUSIC_TEAM_ID}:${env.APPLE_MUSIC_KEY_ID}`;
  const cached = appleMusicTokens.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 60000) return cached;
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "ES256", kid: env.APPLE_MUSIC_KEY_ID }));
  const claims = base64url(JSON.stringify({ iss: env.APPLE_MUSIC_TEAM_ID, iat: now, exp: now + 600 }));
  const signingInput = `${header}.${claims}`;
  let rawKey = (env.APPLE_MUSIC_PRIVATE_KEY ?? "").replace(/\\n/g, "\n");
  if (!rawKey.includes("BEGIN")) rawKey = `-----BEGIN PRIVATE KEY-----\n${rawKey}\n-----END PRIVATE KEY-----`;
  const signer = createSign("sha256");
  signer.update(signingInput);
  signer.end();
  const der = signer.sign({ key: createPrivateKey(rawKey), dsaEncoding: "der" });
  const token = `${signingInput}.${base64url(derSignatureToJose(der))}`;
  const entry = { token, expiresAt: (now + 500) * 1000 };
  appleMusicTokens.set(cacheKey, entry);
  return entry;
}

const appleMusicSearchAdapter: SourceAdapter = {
  id: "commercial_storefront",
  label: "commercial_storefront",
  available: (env) => Boolean(env.APPLE_MUSIC_TEAM_ID && env.APPLE_MUSIC_KEY_ID && env.APPLE_MUSIC_PRIVATE_KEY),
  async search(query, { limit }) {
    const { token } = appleMusicDeveloperToken(process.env);
    const storefront = (process.env.APPLE_MUSIC_STOREFRONT ?? "us").toLowerCase();
    const params = new URLSearchParams({
      term: query, types: "songs", limit: String(Math.min(25, limit)), include: "previews"
    });
    const payload = await fetchJson<{ data?: { songs?: { data?: Array<{
      id: string; attributes?: {
        name?: string; artistName?: string; albumName?: string; durationInMillis?: number;
        isrc?: string; previews?: Array<{ url?: string }>; artwork?: { url?: string };
        url?: string; releaseDate?: string;
      };
    }> } } }>(`https://api.music.apple.com/v1/catalog/${storefront}/search?${params.toString()}`, 8000, {
      headers: { Authorization: `Bearer ${token}` }
    });
    return (payload.data?.songs?.data ?? []).flatMap((song) => {
      const attributes = song.attributes;
      if (!song.id || !attributes?.name) return [];
      // 30s previews from the official API; subscriber streams are never requested.
      const preview = (attributes.previews ?? [])[0]?.url ?? null;
      const artwork = attributes.artwork?.url
        ? attributes.artwork.url.replace(/\{w\}x\{h\}bb\.(png|jpg)/, "300x300bb.$1").replace("{w}", "300").replace("{h}", "300")
        : null;
      return [{
        sourceId: this.id, externalId: song.id, title: attributes.name,
        artist: firstString(attributes.artistName) ?? "Unknown artist",
        album: attributes.albumName ?? null,
        durationSeconds: attributes.durationInMillis ? Math.round(attributes.durationInMillis / 1000) : null,
        artworkUrl: artwork, audioUrl: null, previewUrl: preview,
        sourcePageUrl: attributes.url ?? `https://music.apple.com/song/id${song.id}`,
        licenseUrl: null,
        access: preview ? "preview" as const : "external" as const,
        isrc: validIsrc(attributes.isrc), releaseYear: yearOf(attributes.releaseDate),
        versionTag: classifyVersionTag(attributes.name)
      } satisfies DiscoveryResult];
    });
  }
};

function isoDurationToSeconds(text: unknown): number | null {
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?$/.exec(typeof text === "string" ? text : "");
  if (!match || (match[1] === undefined && match[2] === undefined && match[3] === undefined)) return null;
  return Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Math.round(Number(match[3] ?? 0));
}

const youtubeSearchAdapter: SourceAdapter = {
  id: "video_platform",
  label: "video_platform",
  available: (env) => Boolean(env.YOUTUBE_API_KEY),
  async search(query, { limit }) {
    const params = new URLSearchParams({
      key: process.env.YOUTUBE_API_KEY ?? "", part: "snippet,contentDetails",
      type: "video", maxResults: String(Math.min(20, limit)), q: query
    });
    const payload = await fetchJson<{ items?: Array<{
      id?: { videoId?: string };
      snippet?: { title?: string; channelTitle?: string; publishedAt?: string };
      contentDetails?: { duration?: string };
    }> }>(`https://www.googleapis.com/youtube/v3/search?${params.toString()}`, 8000);
    return (payload.items ?? []).flatMap((item) => {
      const videoId = item.id?.videoId;
      if (!videoId || !item.snippet?.title) return [];
      return [{
        sourceId: this.id, externalId: videoId, title: item.snippet.title,
        artist: firstString(item.snippet.channelTitle) ?? "YouTube channel",
        album: null,
        durationSeconds: isoDurationToSeconds(item.contentDetails?.duration),
        artworkUrl: null,
        // No audio URLs from YouTube: playback is the official embed player only.
        audioUrl: null, previewUrl: null,
        sourcePageUrl: `https://www.youtube.com/watch?v=${videoId}`,
        licenseUrl: null, access: "stream_only" as const,
        isrc: null, releaseYear: yearOf(item.snippet.publishedAt),
        versionTag: classifyVersionTag(item.snippet.title)
      } satisfies DiscoveryResult];
    });
  }
};

const lastfmSearchAdapter: SourceAdapter = {
  id: "social_metadata",
  label: "social_metadata",
  available: (env) => Boolean(env.LASTFM_API_KEY),
  async search(query, { limit }) {
    const params = new URLSearchParams({
      method: "track.search", track: query, format: "json",
      api_key: process.env.LASTFM_API_KEY ?? "", limit: String(Math.min(20, limit))
    });
    const payload = await fetchJson<{ results?: { "opensearch:totalResults"?: string;
      trackmatches?: { trackmatch?: Array<{ name?: string; artist?: string; url?: string }> } };
    }>(`https://ws.audioscrobbler.com/2.0/?${params.toString()}`, 8000);
    const matches = payload.results?.trackmatches?.trackmatch ?? [];
    return matches.flatMap((track) => {
      if (!track.name) return [];
      return [{
        sourceId: this.id, externalId: `${track.artist ?? ""}|${track.name}`,
        title: track.name, artist: firstString(track.artist) ?? "Unknown artist",
        album: null, durationSeconds: null, artworkUrl: null,
        audioUrl: null, previewUrl: null,
        sourcePageUrl: track.url ?? "https://www.last.fm/home",
        licenseUrl: null, access: "external" as const,
        isrc: null, releaseYear: null, versionTag: classifyVersionTag(track.name)
      } satisfies DiscoveryResult];
    });
  }
};

const discogsSearchAdapter: SourceAdapter = {
  id: "discography_database",
  label: "discography_database",
  available: (env) => Boolean(env.DISCOGS_TOKEN),
  async search(query, { limit }) {
    const params = new URLSearchParams({
      type: "release", q: query, per_page: String(Math.min(20, limit))
    });
    const payload = await fetchJson<{ results?: Array<{
      id: number; title?: string; artist?: string; year?: number; thumb?: string;
      uri?: string; cover_image?: string;
    }> }>(`https://api.discogs.com/database/search?${params.toString()}`, 8000, {
      headers: { Authorization: `Discogs token=${process.env.DISCOGS_TOKEN ?? ""}`,
        "User-Agent": "SONORA/0.2 (music discovery app)" }
    });
    return (payload.results ?? []).flatMap((release) => {
      if (!release.id || !release.title) return [];
      return [{
        sourceId: this.id, externalId: String(release.id), title: release.title,
        artist: firstString(release.artist) ?? "Unknown artist",
        album: null, durationSeconds: null,
        artworkUrl: release.thumb || release.cover_image || null,
        audioUrl: null, previewUrl: null,
        sourcePageUrl: release.uri ?? `https://www.discogs.com/release/${release.id}`,
        licenseUrl: null, access: "metadata" as const,
        isrc: null, releaseYear: release.year ?? null,
        versionTag: classifyVersionTag(release.title)
      } satisfies DiscoveryResult];
    });
  }
};

const soundcloudSearchAdapter: SourceAdapter = {
  id: "creator_audio_platform",
  label: "creator_audio_platform",
  available: (env) => Boolean(env.SOUNDCLOUD_CLIENT_ID),
  async search(query, { limit }) {
    const params = new URLSearchParams({
      q: query, client_id: process.env.SOUNDCLOUD_CLIENT_ID ?? "", limit: String(Math.min(20, limit))
    });
    const payload = await fetchJson<Array<{
      id: number; title?: string; full_duration?: number; permalink_url?: string;
      user?: { name?: string }; license?: string; artwork_url?: string;
    }>>(`https://api.soundcloud.com/i1/tracks/?${params.toString()}`, 8000);
    return payload.flatMap((track) => {
      if (!track.id || !track.title) return [];
      // SoundCloud stream URLs require user-gated OAuth and platform terms
      // forbid redistribution, so everything stays official-player/embed only.
      const ccLicense = isOpenLicenseUrl(track.license ?? "");
      return [{
        sourceId: this.id, externalId: String(track.id), title: track.title,
        artist: firstString(track.user?.name) ?? "SoundCloud creator",
        album: null,
        durationSeconds: track.full_duration ? Math.round(track.full_duration / 1000) : null,
        artworkUrl: track.artwork_url ? track.artwork_url.replace("-large", "-t500") : null,
        audioUrl: null, previewUrl: null,
        sourcePageUrl: track.permalink_url ?? "https://soundcloud.com",
        licenseUrl: ccLicense ? track.license ?? null : null,
        access: "stream_only" as const,
        isrc: null, releaseYear: null, versionTag: classifyVersionTag(track.title)
      } satisfies DiscoveryResult];
    });
  }
};

// ---------------------------------------------------------------------------
// Adapter: curated_open_catalogs (GitHub allow-list). Only exact
// owner/repo[/path@ref] entries listed in GITHUB_CATALOG_REPOS are fetched —
// never a search or scan of GitHub itself. Audio is surfaced only when the
// row itself declares an https audio URL plus an open license URL.
// ---------------------------------------------------------------------------

type CatalogRow = {
  id?: string | number; title?: string; artist?: string; album?: string | null;
  duration_seconds?: number; audio_url?: string; page_url?: string; url?: string;
  license_url?: string; isrc?: string; release_year?: number | string;
};

async function fetchCatalogRows(repo: string, signalPath: { path: string; ref: string }): Promise<CatalogRow[]> {
  const url = `https://raw.githubusercontent.com/${repo}/${signalPath.ref || "HEAD"}/${encodeURI(signalPath.path)}`;
  const payload = await fetchJson<unknown>(url, 8000);
  return Array.isArray(payload) ? payload as CatalogRow[] : [];
}

const githubCatalogsAdapter: SourceAdapter = {
  id: "curated_open_catalogs",
  label: "curated_open_catalogs",
  available: (env) => Boolean(env.GITHUB_CATALOG_REPOS?.trim()),
  async search(query, { limit }) {
    const entries = (process.env.GITHUB_CATALOG_REPOS ?? "")
      .split(",").map((value) => value.trim()).filter(Boolean).slice(0, 8);
    const needle = normalizeForMatch(query);
    if (!needle || !entries.length) return [];
    const fetched = await Promise.allSettled(entries.map((entry) => {
      // owner/repo[/path@ref]: only the exact allow-listed file is fetched.
      const parts = entry.split("/");
      const repo = parts.slice(0, 2).join("/");
      const fileSpec = parts.slice(2).join("/") || "catalog.json";
      const [path, ref = "HEAD"] = fileSpec.split("@");
      return fetchCatalogRows(repo, { path, ref }).then((rows) => rows.map((row) => ({ row })));
    }));
    const out: DiscoveryResult[] = [];
    for (const settled of fetched) {
      if (settled.status !== "fulfilled") continue;
      for (const { row } of settled.value) {
        if (out.length >= limit) break;
        const title = firstString(row.title);
        if (!title) continue;
        const hay = normalizeForMatch(title);
        // Curated catalogs are small by policy: cheap containment both ways.
        if (!(hay.includes(needle) || needle.includes(hay))) continue;
        const licensed = isOpenLicenseUrl(row.license_url);
        const audioUrl = licensed && row.audio_url?.startsWith("https://") ? row.audio_url : null;
        const pageUrl = firstString(row.page_url, row.url) ?? "";
        out.push({
          sourceId: this.id,
          externalId: String(row.id ?? "").slice(0, 64) || hay,
          title, artist: firstString(row.artist) ?? "Curated catalog artist",
          album: typeof row.album === "string" ? row.album : null,
          durationSeconds: finiteNumber(row.duration_seconds), artworkUrl: null,
          audioUrl, previewUrl: null,
          sourcePageUrl: pageUrl.startsWith("http") ? pageUrl : "https://github.com",
          licenseUrl: licensed ? row.license_url ?? null : null,
          access: audioUrl ? "open" as const : "metadata" as const,
          isrc: validIsrc(row.isrc), releaseYear: yearOf(row.release_year),
          versionTag: classifyVersionTag(title)
        });
      }
    }
    return out;
  }
};

// ---------------------------------------------------------------------------
// Adapter registry & fan-out engine
// ---------------------------------------------------------------------------

export const discoveryAdapters: SourceAdapter[] = [
  jamendoCollectionAdapter,
  audiusPlatformAdapter,
  openArchiveAdapter,
  openverseAudioAdapter,
  ccMixterAdapter,
  applePreviewsAdapter,
  metadataGraphAdapter,
  githubCatalogsAdapter,
  spotifySearchAdapter,
  deezerSearchAdapter,
  appleMusicSearchAdapter,
  youtubeSearchAdapter,
  lastfmSearchAdapter,
  discogsSearchAdapter,
  soundcloudSearchAdapter
];

const ADAPTER_BY_ID = new Map(discoveryAdapters.map((adapter) => [adapter.id, adapter]));

/** Adapters whose 'open' results may back a full-track match. */
export const OPEN_RESOLVE_ADAPTER_IDS = [
  "independent_collection", "platform_stream_catalog", "open_archive",
  "open_license_index", "open_remix_archive"
];

const FAN_OUT_BUDGET_MS = 9000;

/**
 * Query only the open-licensed catalogs (Archive, Openverse, ccMixter — the
 * discovery stage added on top of the legacy Jamendo/Audius import pools).
 * Used by the import service's third matching stage.
 */
export async function runDiscoveryOpenPool(query: string, limit: number): Promise<DiscoveryResult[]> {
  const ids = OPEN_RESOLVE_ADAPTER_IDS.filter((id) => !["independent_collection", "platform_stream_catalog"].includes(id));
  const adapters = ids
    .map((id) => ADAPTER_BY_ID.get(id))
    .filter((adapter): adapter is SourceAdapter => Boolean(adapter && adapter.available(process.env)));
  const settled = await Promise.allSettled(
    adapters.map((adapter) => withinBudget(adapter.search(query, { limit })))
  );
  return settled.flatMap((entry) => entry.status === "fulfilled" ? entry.value : []);
}

export type ProviderStatus = { ok: boolean; count: number; error?: string };

async function withinBudget<T>(work: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const guard = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`adapter exceeded ${FAN_OUT_BUDGET_MS}ms budget`)), FAN_OUT_BUDGET_MS);
  });
  try {
    return await Promise.race([work, guard]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export type DiscoverySearchReport = {
  query: string;
  groups: DiscoveryGroup[];
  providers: Record<string, ProviderStatus>;
  took_ms: number;
};

/**
 * Fan out to every available adapter concurrently. Adapters that are not
 * configured (missing env) or that fail are reported per-provider and never
 * break the overall response.
 */
export async function runDiscoverySearch(
  rawQuery: string, rawLimit: unknown, rawSources: unknown, env: NodeJS.ProcessEnv
): Promise<DiscoverySearchReport> {
  const started = Date.now();
  const query = rawQuery.trim().slice(0, 100);
  const limit = clampLimit(rawLimit, 12);
  const sourceFilter = typeof rawSources === "string" && rawSources.trim()
    ? rawSources.split(",").map((value) => value.trim()).filter(Boolean) : null;
  if (sourceFilter) {
    const unknown = sourceFilter.filter((id) => !ADAPTER_BY_ID.has(id));
    if (unknown.length) throw new DiscoveryInputError(`Unknown sources: ${unknown.join(", ")}`);
  }
  const selected = discoveryAdapters.filter((adapter) =>
    (!sourceFilter || sourceFilter.includes(adapter.id)) && adapter.available(env));

  const providers: Record<string, ProviderStatus> = {};
  for (const adapter of discoveryAdapters) {
    if (sourceFilter && !sourceFilter.includes(adapter.id)) continue;
    if (!adapter.available(env)) providers[adapter.id] = { ok: false, count: 0, error: "not configured (missing env)" };
  }

  const settled = await Promise.allSettled(selected.map(async (adapter) => {
    const results = await withinBudget(adapter.search(query, { limit }));
    return { id: adapter.id, results };
  }));

  const results: DiscoveryResult[] = [];
  settled.forEach((entry, index) => {
    const id = selected[index].id;
    if (entry.status === "fulfilled") {
      providers[id] = { ok: true, count: entry.value.results.length };
      results.push(...entry.value.results);
    } else {
      providers[id] = {
        ok: false, count: 0,
        error: entry.reason instanceof Error ? entry.reason.message.slice(0, 160) : "adapter failed"
      };
    }
  });

  return { query, groups: groupDiscoveryResults(results), providers, took_ms: Date.now() - started };
}

export class DiscoveryInputError extends Error {
  constructor(message: string) { super(message); this.name = "DiscoveryInputError"; }
}

// ---------------------------------------------------------------------------
// Best-licensed-audio resolver (used by /discovery/resolve and import jobs)
// ---------------------------------------------------------------------------

export type ResolveInput = {
  artist?: unknown; title?: unknown; isrc?: unknown; durationSeconds?: unknown;
};

export type ResolvedTrack = {
  found: boolean;
  track: DiscoveryResult | null;
  matched_via: "isrc" | "meta+duration" | "title-only";
  confidence: number;
  /** Present when the only honest match is a preview/external page. */
  preview_alternative?: DiscoveryResult | null;
  providers?: Record<string, ProviderStatus>;
};

const RESOLVE_MATCH_THRESHOLD = 0.55;
const DURATION_AGREEMENT_SECONDS = 15;

function durationAgrees(want: number | null, have: number | null): boolean {
  return want !== null && have !== null && Math.abs(want - have) <= DURATION_AGREEMENT_SECONDS;
}

function toCandidateShape(result: DiscoveryResult): { artist: string; title: string; durationSeconds?: number | null } {
  return { artist: result.artist, title: result.title, durationSeconds: result.durationSeconds };
}

/**
 * Find the single best licensed full audio for {artist,title,isrc?,duration?}.
 * Only open-licensed adapters may produce found=true; previews and platform
 * links are reported as preview_alternative instead, per the legal boundary.
 * metadataGraph (MusicBrainz) is consulted for ISRC verification.
 */
export async function resolveBestTrack(input: ResolveInput, env: NodeJS.ProcessEnv): Promise<ResolvedTrack> {
  const title = firstString(input.title)?.slice(0, 200);
  const artist = firstString(input.artist)?.slice(0, 200) ?? "";
  const isrc = validIsrc(input.isrc);
  const duration = finiteNumber(input.durationSeconds);
  if (!title && !isrc) throw new DiscoveryInputError("Provide at least a title or an ISRC.");
  const query = (isrc ? `isrc:${isrc}` : [artist, title].filter(Boolean).join(" ")).slice(0, 100);
  if (!query.trim()) throw new DiscoveryInputError("Provide at least a title or an ISRC.");

  const openAdapters = OPEN_RESOLVE_ADAPTER_IDS
    .map((id) => ADAPTER_BY_ID.get(id))
    .filter((adapter): adapter is SourceAdapter => Boolean(adapter && adapter.available(env)));
  const graphAdapter = ADAPTER_BY_ID.get("metadata_graph");
  const previewAdapter = ADAPTER_BY_ID.get("platform_preview");

  const wanted = { artist, title: title ?? "", durationSeconds: duration };
  const pool = async (adapter: SourceAdapter | undefined): Promise<DiscoveryResult[]> =>
    adapter && adapter.available(env)
      ? await withinBudget(adapter.search(query, { limit: 8 })).catch(() => [] as DiscoveryResult[])
      : [];
  const fanOut = await Promise.all([
    pool(graphAdapter),
    ...openAdapters.map((adapter) => pool(adapter)),
    pool(previewAdapter)
  ]);
  const graphHits = fanOut[0] ?? [];
  const openResults = fanOut.slice(1, 1 + openAdapters.length).flat();
  const previewResults = fanOut[1 + openAdapters.length] ?? [];

  // ISRC first: an exact ISRC hit on an open result is the strongest evidence.
  const verifiedByGraph = isrc !== null && graphHits.some((hit) => hit.isrc === isrc);
  const scoredOpen = openResults
    .filter((result) => result.access === "open" && result.audioUrl)
    .map((result) => ({
      result,
      score: isrc && result.isrc === isrc ? Math.max(scoreMatch(toCandidateShape(result), wanted), 0.95)
        : scoreMatch(toCandidateShape(result), wanted),
      via: (isrc && result.isrc === isrc) || verifiedByGraph && scoreMatch(toCandidateShape(result), wanted) >= 0.8
        ? "isrc" as const
        : durationAgrees(duration, result.durationSeconds ?? null) && scoreMatch(toCandidateShape(result), wanted) >= 0.7
          ? "meta+duration" as const
          : "title-only" as const
    }))
    .filter((entry) => entry.score >= RESOLVE_MATCH_THRESHOLD)
    .sort((a, b) => b.score - a.score || ACCESS_RANK[a.result.access] - ACCESS_RANK[b.result.access]);

  const bestOpen = scoredOpen[0];
  if (bestOpen) {
    let confidence = bestOpen.score;
    if (bestOpen.via === "isrc") confidence = Math.max(confidence, 0.95);
    else if (bestOpen.via === "meta+duration") confidence = Math.min(0.9, confidence + 0.05);
    else if (!wanted.artist) confidence = Math.min(confidence, 0.75);
    return {
      found: true, track: bestOpen.result, matched_via: bestOpen.via,
      confidence: Math.round(Math.max(0, Math.min(1, confidence)) * 100) / 100
    };
  }

  // Honest fallback: full audio is not available in open catalogs. The best
  // preview (iTunes/other adapters) or link-only result is reported as an
  // alternative — never as found=true.
  const previewCandidates = [...openResults.filter((r) => r.access !== "open"), ...previewResults]
    .map((result) => ({ result, score: scoreMatch(toCandidateShape(result), wanted) }))
    .filter((entry) => entry.score >= 0.6)
    .sort((a, b) => ACCESS_RANK[a.result.access] - ACCESS_RANK[b.result.access] || b.score - a.score);
  const alternative = previewCandidates[0]?.result ?? null;
  const graphAnchor = graphHits.find((hit) => scoreMatch(toCandidateShape(hit), wanted) >= 0.7);
  const via: ResolvedTrack["matched_via"] = isrc && (verifiedByGraph || graphAnchor) ? "isrc"
    : durationAgrees(duration, alternative?.durationSeconds ?? null) ? "meta+duration" : "title-only";
  const confidence = alternative
    ? Math.max(...previewCandidates.map((entry) => entry.score)) : (graphAnchor ? 0.4 : 0);
  return {
    found: false, track: null,
    matched_via: via,
    confidence: Math.round(Math.max(0, Math.min(1, confidence)) * 100) / 100,
    preview_alternative: via === "isrc" && graphAnchor
      ? { ...graphAnchor, audioUrl: null, access: "metadata" } : alternative
  };
}

/**
 * Map an open DiscoveryResult back to the JamendoCandidate shape the import
 * service persists. Only 'open' results are convertible; anything else must
 * stay link-only in the UI and never enters a user's playlist.
 */
export function licensedCandidate(result: DiscoveryResult): JamendoCandidate | null {
  if (result.access !== "open" || !result.audioUrl) return null;
  // Values must stay inside the provider CHECK set of migrations 006/009
  // (executeImport lowercases them before storage).
  const providerBySource: Record<string, string> = {
    independent_collection: "jamendo", platform_stream_catalog: "audius",
    open_archive: "internet_archive", open_license_index: "openverse",
    open_remix_archive: "ccmixter"
  };
  return {
    id: `${result.sourceId}:${result.externalId}`,
    providerTrackId: result.externalId.slice(0, 64),
    title: result.title, artist: result.artist, album: result.album ?? null,
    durationSeconds: result.durationSeconds ?? 0, genres: [],
    artworkUrl: result.artworkUrl ?? null, audioUrl: result.audioUrl,
    licenseUrl: result.licenseUrl ?? "", sourceUrl: result.sourcePageUrl,
    provider: providerBySource[result.sourceId] ?? result.sourceId, playable: true
  };
}

// ---------------------------------------------------------------------------
// HTTP registration (called from index.ts)
// ---------------------------------------------------------------------------

export function registerDiscoveryRoutes(app: FastifyInstance): void {
  const discoveryRateLimit = {
    config: { rateLimit: { keyGenerator: (request: FastifyRequest) => request.ip, max: 30, timeWindow: "1 minute" } }
  };

  app.get<{ Querystring: { q?: string; limit?: string; sources?: string } }>(
    "/api/v1/discovery/search", discoveryRateLimit, async (request, reply) => {
      const q = request.query.q?.trim() ?? "";
      if (q.length < 2) return reply.code(400).send({ statusCode: 400, error: "Search query must contain at least two characters." });
      try {
        return await runDiscoverySearch(q, request.query.limit, request.query.sources, process.env);
      } catch (error) {
        if (error instanceof DiscoveryInputError) return reply.code(400).send({ statusCode: 400, error: error.message });
        request.log.error({ err: error }, "Discovery search failed");
        return reply.code(502).send({ statusCode: 502, error: "Discovery engine is temporarily unavailable." });
      }
    }
  );

  app.post<{ Body: ResolveInput }>("/api/v1/discovery/resolve", discoveryRateLimit, async (request, reply) => {
    try {
      return await resolveBestTrack(request.body ?? {}, process.env);
    } catch (error) {
      if (error instanceof DiscoveryInputError) return reply.code(400).send({ statusCode: 400, error: error.message });
      request.log.error({ err: error }, "Discovery resolve failed");
      return reply.code(502).send({ statusCode: 502, error: "Discovery engine is temporarily unavailable." });
    }
  });
}
