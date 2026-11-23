import { readFile, stat } from "node:fs/promises";
import type { FastifyInstance } from "fastify";

const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_LRC_CHARS = 32_000;
const MAX_LINES = 500;
const MAX_TIMESTAMP_MS = 24 * 60 * 60 * 1000;
const TRACK_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;

export interface LyricLine {
  timeMs: number;
  text: string;
}

export function parseLrc(lrc: string): LyricLine[] {
  if (!lrc || lrc.length > MAX_LRC_CHARS) return [];
  const rows = lrc.split(/\r?\n/);
  const offsetTag = rows.find((row) => /^\s*\[offset:[+-]?\d{1,6}\]\s*$/i.test(row));
  const offsetMs = offsetTag ? Number(offsetTag.match(/[+-]?\d+/)?.[0] ?? 0) : 0;
  const lines: LyricLine[] = [];
  for (const row of rows) {
    const textRow = row.trim();
    const prefix = textRow.match(/^(?:\[\d{1,4}:[0-5]\d(?:[.:]\d{1,3})?\])+/)?.[0];
    if (!prefix) continue;
    const text = textRow.slice(prefix.length).trim();
    if (!text || text.length > 300) continue;
    for (const stamp of prefix.matchAll(/\[(\d+):(\d{2})(?:[.:](\d{1,3}))?\]/g)) {
      const [, minutes, seconds, fraction = ""] = stamp;
      const timeMs = Math.max(0, (Number(minutes) * 60 + Number(seconds)) * 1000 + Number(fraction.padEnd(3, "0")) + offsetMs);
      if (timeMs > MAX_TIMESTAMP_MS) continue;
      lines.push({ timeMs, text });
      if (lines.length > MAX_LINES) return [];
    }
  }
  return lines.sort((a, b) => a.timeMs - b.timeMs);
}

function readText(value: unknown, max: number) {
  return typeof value === "string" && value.trim().length <= max ? value.trim() : "";
}

type Entry = {
  lines: LyricLine[];
  rightsHolder: string;
  expiresAt: number;
};

function parseEntry(value: unknown): [string, Entry] | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const id = readText(record.id, 128);
  const rightsHolder = readText(record.rightsHolder, 160);
  // Presence of an explicit display grant and its reference is required, separate from audio rights.
  const licenseRef = readText(record.licenseRef, 200);
  const expiry = typeof record.displayUntil === "string" && /^\d{4}-\d{2}-\d{2}T.*Z$/.test(record.displayUntil)
    ? Date.parse(record.displayUntil) : NaN;
  if (!TRACK_ID.test(id) || !rightsHolder || !licenseRef || record.displayAllowed !== true ||
      (record.displayUntil !== null && !Number.isFinite(expiry))) return null;
  const lines = parseLrc(readText(record.lrc, MAX_LRC_CHARS));
  return lines.length ? [id, { lines, rightsHolder, expiresAt: record.displayUntil === null ? Infinity : expiry }] : null;
}

export function registerLyricsRoutes(app: FastifyInstance, env: NodeJS.ProcessEnv) {
  const file = env.SONORA_LICENSED_LYRICS_FILE?.trim();
  let snapshot: { stamp: string; entries: Map<string, Entry> } | undefined;

  async function entries(path: string) {
    const info = await stat(path);
    if (!info.isFile() || info.size > MAX_MANIFEST_BYTES) throw new Error("Invalid lyrics manifest.");
    const stamp = [info.ino, info.size, info.mtimeMs, info.ctimeMs].join(":");
    if (snapshot?.stamp === stamp) return snapshot.entries;
    const raw: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!Array.isArray(raw)) throw new Error("Lyrics manifest must be an array.");
    const next = new Map<string, Entry>();
    const ids = new Set<string>();
    for (const row of raw) {
      const id = row && typeof row === "object" ? readText(row.id, 128) : "";
      if (id && ids.has(id)) throw new Error("Duplicate lyrics track ID.");
      if (id) ids.add(id);
      const entry = parseEntry(row);
      if (entry) next.set(...entry);
    }
    snapshot = { stamp, entries: next };
    return next;
  }

  app.get<{ Querystring: { id?: string } }>("/api/v1/lyrics", {
    config: { rateLimit: { max: 60, timeWindow: "1 minute" } }
  }, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const id = request.query.id;
    if (typeof id !== "string" || !TRACK_ID.test(id)) return reply.code(400).send({ status: "invalid" });
    if (!file) return { status: "unavailable" };
    try {
      const entry = (await entries(file)).get(id);
      if (!entry || entry.expiresAt <= Date.now()) return { status: "unavailable" };
      return { status: "available", lines: entry.lines, rightsHolder: entry.rightsHolder };
    } catch {
      return reply.code(503).send({ status: "error" });
    }
  });
}
