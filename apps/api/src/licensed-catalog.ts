import { readFile, stat } from "node:fs/promises";
import type { FastifyInstance } from "fastify";
import { catalogSearchKey, matchesCatalogSearch } from "./catalog.js";

const TRACK_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const AUDIO_PATH = /^(?:[a-z0-9_-]+\/)*[a-z0-9_-][a-z0-9_.-]*\.(?:mp3|m4a|aac|ogg|opus|flac|wav)$/i;
const ISRC = /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/;
const MAX_CATALOG_BYTES = 2 * 1024 * 1024;
const TRACKS_PATH = "/api/v1/providers/sonora/tracks";

function origin(value: string | undefined): string | null {
  try {
    const url = new URL(value ?? "");
    return url.protocol === "https:" && !url.username && !url.password && url.pathname === "/" &&
      !url.search && !url.hash ? url.origin : null;
  } catch {
    return null;
  }
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 200) : "";
}

function httpsUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

function expiresAt(value: unknown): number {
  if (value === null) return Infinity;
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T.*Z$/.test(value)
    ? Date.parse(value)
    : NaN;
}

type Entry = NonNullable<ReturnType<typeof parseEntry>>;

function parseEntry(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  const id = typeof data.id === "string" ? data.id : "";
  const audioPath = typeof data.audioPath === "string" ? data.audioPath : "";
  const title = text(data.title);
  const artist = text(data.artist);
  const rightsHolder = text(data.rightsHolder);
  const expiry = expiresAt(data.availableUntil);
  if (!TRACK_ID.test(id) || !AUDIO_PATH.test(audioPath) || !title || !artist ||
      !rightsHolder || !text(data.licenseRef) || data.streamingAllowed !== true || Number.isNaN(expiry)) return null;

  const isrc = text(data.isrc).toUpperCase().replaceAll("-", "");
  return {
    id, audioPath, expiry, title, artist, rightsHolder,
    album: text(data.album) || null,
    durationSeconds: typeof data.durationSeconds === "number" && Number.isFinite(data.durationSeconds)
      ? Math.max(0, Math.round(data.durationSeconds)) : 0,
    isrc: ISRC.test(isrc) ? isrc : null,
    artworkUrl: httpsUrl(data.artworkUrl),
    sourceUrl: httpsUrl(data.sourceUrl),
    licenseUrl: httpsUrl(data.licenseUrl)
  };
}

export function createLicensedCatalog(env: NodeJS.ProcessEnv) {
  const path = env.SONORA_LICENSED_CATALOG_FILE;
  const audioOrigin = origin(env.SONORA_LICENSED_AUDIO_ORIGIN);
  const apiOrigin = origin(env.SONORA_LICENSED_API_ORIGIN);
  let snapshot: { key: string; entries: Map<string, Entry> } | undefined;

  async function entries() {
    if (!path) return new Map<string, Entry>();
    if (!audioOrigin || !apiOrigin) throw new Error("Licensed catalog origins are invalid.");
    const file = await stat(path).catch(() => null);
    if (!file?.isFile() || file.size > MAX_CATALOG_BYTES) throw new Error("Licensed catalog file is invalid.");
    const key = [file.ino, file.size, file.mtimeMs, file.ctimeMs].join(":");
    if (snapshot?.key === key) return snapshot.entries;
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(path, "utf8"));
    } catch {
      throw new Error("Licensed catalog could not be read.");
    }
    if (!Array.isArray(raw)) throw new Error("Licensed catalog must be a JSON array.");
    const records = new Map<string, Entry>();
    const ids = new Set<string>();
    for (const value of raw) {
      const id = value && typeof value.id === "string" ? value.id : null;
      if (id && ids.has(id)) throw new Error("Duplicate licensed catalog track ID.");
      if (id) ids.add(id);
      const record = parseEntry(value);
      if (record) records.set(record.id, record);
    }
    snapshot = { key, entries: records };
    return records;
  }

  function track(record: Entry) {
    return {
      id: `sonora:${record.id}`, providerTrackId: record.id, provider: "SONORA",
      title: record.title, artist: record.artist, album: record.album, isrc: record.isrc,
      durationSeconds: record.durationSeconds, artworkUrl: record.artworkUrl,
      sourceUrl: record.sourceUrl, licenseUrl: record.licenseUrl,
      audioUrl: `${apiOrigin}${TRACKS_PATH}/${record.id}/audio`,
      playable: true, rightsLabel: record.rightsHolder
    };
  }

  async function available(id: string) {
    const record = TRACK_ID.test(id) ? (await entries()).get(id) : undefined;
    return record && record.expiry > Date.now() ? record : undefined;
  }

  return {
    configured: Boolean(path),
    async search(q: string, limit: number, artistsOnly = false) {
      const now = Date.now();
      return [...(await entries()).values()]
        .filter((item) => item.expiry > now &&
          (artistsOnly ? matchesCatalogSearch(q, item.artist) :
            item.isrc === q.toUpperCase() || matchesCatalogSearch(q, item.artist, item.title, item.album)))
        .slice(0, limit)
        .map(track);
    },
    async match(input: { artist?: unknown; title?: unknown; isrc?: unknown; durationSeconds?: unknown }) {
      const artist = catalogSearchKey(input.artist);
      const title = catalogSearchKey(input.title);
      const isrc = text(input.isrc).toUpperCase().replaceAll("-", "");
      const now = Date.now();
      const records = [...(await entries()).values()].filter((item) => item.expiry > now);
      const exact = isrc ? records.find((item) => item.isrc === isrc) : undefined;
      if (exact) return { playableTrack: track(exact), matchedVia: "isrc" };
      if (!artist || !title) return null;
      const duration = typeof input.durationSeconds === "number" ? input.durationSeconds : 0;
      const matches = records.filter((item) => catalogSearchKey(item.artist) === artist &&
        catalogSearchKey(item.title) === title && (!isrc || !item.isrc || item.isrc === isrc) &&
        (!duration || !item.durationSeconds || Math.abs(duration - item.durationSeconds) <= 15));
      return matches.length === 1 ? { playableTrack: track(matches[0]), matchedVia: "artist+title" } : null;
    },
    register(app: FastifyInstance) {
      app.get<{ Querystring: { id?: string } }>(TRACKS_PATH, async (request, reply) => {
        reply.header("Cache-Control", "no-store");
        const record = await available(request.query.id ?? "");
        return { items: record ? [track(record)] : [] };
      });
      app.get<{ Params: { id: string } }>(`${TRACKS_PATH}/:id/audio`, async (request, reply) => {
        reply.header("Cache-Control", "no-store");
        const record = await available(request.params.id);
        if (!record) return reply.code(404).send({ error: "Audio is unavailable." });
        return reply.redirect(`${audioOrigin}/${record.audioPath}`);
      });
    }
  };
}
