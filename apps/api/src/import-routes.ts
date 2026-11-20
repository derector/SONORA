// Server-side music import service for SONORA ("перенос треков с других
// площадок — автоматически и по ссылкам").
//
// Compliance stance (docs/AGENT_WORKFLOW.md): no DRM/ToS circumvention, no
// unofficial authenticated APIs, never fake results. Only public, keyless,
// documented endpoints are called; platforms without such access honestly
// return needsManualExport guidance instead of pretending to import. Audio
// is NEVER taken from source platforms: every attached track comes from
// SONORA's own licensed catalog (Jamendo/Audius) with license + attribution.

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { SupabaseClient } from "@supabase/supabase-js";
import { authError, requireUser } from "./auth-helpers.js";
import { audiusCandidates, jamendoCandidates, type JamendoCandidate } from "./catalog.js";
import {
  parseGenericList, parseSourceUrl, parseSpotifyExportJson, scoreMatch,
  type ImportListItem, type ImportSourceKind, type ParsedSource
} from "./import-core.js";

type Auth = NonNullable<Awaited<ReturnType<typeof requireUser>>>;

// Same policy as the assistant write path: 120 requests/minute per IP.
const writeRateLimit = {
  config: { rateLimit: { keyGenerator: (request: FastifyRequest) => request.ip, max: 120, timeWindow: "1 minute" } }
};

const MATCH_THRESHOLD = 0.55;
const MAX_IMPORT_ITEMS = 200;
const MAX_UPSTREAM_SEARCHES = 40;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MIGRATIONS_MESSAGE = "Import storage is not available yet: migration 008_import_jobs has not been applied to the database.";

type DbError = { code?: string; message?: string } | null | undefined;

function isMissingRelation(error: DbError): boolean {
  if (!error) return false;
  const message = (error.message ?? "").toLowerCase();
  return error.code === "42P01" || error.code === "PGRST205" ||
    message.includes("could not find the table") || message.includes("does not exist");
}

// ---------------------------------------------------------------------------
// SSRF-guarded public fetch: https only, fixed allowlist of exact hosts, no
// redirects followed, hard 10s timeout.
// ---------------------------------------------------------------------------
const PUBLIC_FETCH_HOSTS = new Set([
  "api.deezer.com",
  "api.jamendo.com",
  "soundcloud.com",
  "accounts.spotify.com", // only ever used with operator-provided app credentials
  "api.spotify.com"      // idem
]);

async function fetchPublicJson(url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<unknown> {
  const target = new URL(url);
  if (target.protocol !== "https:" || !PUBLIC_FETCH_HOSTS.has(target.hostname.toLowerCase())) {
    throw new Error(`Blocked fetch target: ${target.hostname}`);
  }
  const response = await fetch(target.toString(), {
    method: init?.method ?? "GET",
    headers: { Accept: "application/json", ...(init?.headers ?? {}) },
    body: init?.body,
    redirect: "error",
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return await response.json();
}

function isKnownCcLicense(licenseUrl: string): boolean {
  const normalized = licenseUrl.toLowerCase()
    .replace("http://creativecommons.org/", "")
    .replace("https://creativecommons.org/", "")
    .replace("https://www.creativecommons.org/", "");
  const slug = normalized.startsWith("licenses/") ? normalized.split("/")[1] ?? "" : "";
  return normalized.startsWith("publicdomain/zero/") ||
    ["by", "by-sa", "by-nd", "by-nc", "by-nc-sa", "by-nc-nd"].includes(slug);
}

// ---------------------------------------------------------------------------
// Unified-catalog matching pipeline
// ---------------------------------------------------------------------------
type ResolvedMatch = { candidate: JamendoCandidate | null; status: "matched" | "not_found" | "error" };
type MatchState = {
  jamendo: Map<string, JamendoCandidate[]>;
  audius: Map<string, JamendoCandidate[]>;
  searches: number;
};

async function matchAgainstCatalog(item: ImportListItem, state: MatchState, log: FastifyRequest["log"]): Promise<ResolvedMatch> {
  const query = [item.artist, item.title].filter(Boolean).join(" ").trim().slice(0, 100);
  if (query.replace(/\s/g, "").length < 3) return { candidate: null, status: "not_found" };
  try {
    let best: JamendoCandidate | null = null;
    let bestScore = 0;
    // Jamendo first (three candidates per query, like the recommendation path).
    let pool = state.jamendo.get(query);
    if (pool === undefined) {
      if (state.searches >= MAX_UPSTREAM_SEARCHES) return { candidate: null, status: "not_found" };
      state.searches += 1;
      pool = await jamendoCandidates(query, 3);
      state.jamendo.set(query, pool);
    }
    for (const candidate of pool) {
      const score = scoreMatch(candidate, item);
      if (score > bestScore) { bestScore = score; best = candidate; }
    }
    if (best && bestScore >= MATCH_THRESHOLD) return { candidate: best, status: "matched" };
    // Audius public search as the second licensed source.
    pool = state.audius.get(query);
    if (pool === undefined) {
      if (state.searches >= MAX_UPSTREAM_SEARCHES) return { candidate: null, status: "not_found" };
      state.searches += 1;
      pool = await audiusCandidates(query, 5);
      state.audius.set(query, pool);
    }
    for (const candidate of pool) {
      const score = scoreMatch(candidate, item);
      if (score > bestScore) { bestScore = score; best = candidate; }
    }
    return best && bestScore >= MATCH_THRESHOLD ? { candidate: best, status: "matched" } : { candidate: null, status: "not_found" };
  } catch (error) {
    log.warn({ err: error }, "Import catalog lookup failed for one item");
    return { candidate: null, status: "error" };
  }
}

async function insertChunked(client: SupabaseClient, table: string, rows: Array<Record<string, unknown>>): Promise<DbError> {
  for (let offset = 0; offset < rows.length; offset += 50) {
    const { error } = await client.from(table).insert(rows.slice(offset, offset + 50));
    if (error) return error as DbError;
  }
  return null;
}

type ImportArgs = {
  sourceKind: ImportSourceKind;
  sourceUrl: string | null;
  sourceLabel: string | null;
  items: ImportListItem[];
  /** Override when the source platform IS the licensed catalog (Jamendo playlists). */
  matcher?: (item: ImportListItem, index: number) => Promise<ResolvedMatch>;
  note?: string;
};

async function executeImport(
  request: FastifyRequest, reply: FastifyReply, auth: Auth, args: ImportArgs
): Promise<void> {
  const items = args.items.filter((item) => item.title.trim()).slice(0, MAX_IMPORT_ITEMS);
  const truncated = args.items.length > items.length;
  if (!items.length) {
    await reply.code(400).send(authError(400, "No usable track rows were found in this import source."));
    return;
  }
  const { data: job, error: jobError } = await auth.client.from("import_jobs").insert({
    user_id: auth.user.id,
    source_kind: args.sourceKind,
    source_url: args.sourceUrl,
    source_label: args.sourceLabel?.slice(0, 200) ?? null,
    status: "pending"
  }).select("id,source_kind,source_url,source_label,status,error,created_at").single();
  if (jobError || !job) {
    request.log.error({ code: jobError?.code, message: jobError?.message }, "Import job creation failed");
    if (isMissingRelation(jobError)) {
      await reply.code(503).send({ ...authError(503, MIGRATIONS_MESSAGE), needsMigration: "008_import_jobs" });
      return;
    }
    await reply.code(503).send(authError(503, "Could not start the import right now. Try again in a moment."));
    return;
  }

  const state: MatchState = { jamendo: new Map(), audius: new Map(), searches: 0 };
  const itemRows: Array<Record<string, unknown>> = [];
  const matchedTracks: JamendoCandidate[] = [];
  const matchedKeys = new Set<string>();
  let matched = 0;
  let notFound = 0;
  let matchErrors = 0;

  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    const resolution = args.matcher
      ? await args.matcher(item, index)
      : await matchAgainstCatalog(item, state, request.log);
    const row: Record<string, unknown> = {
      job_id: job.id,
      position: index,
      artist: item.artist.trim().slice(0, 200) || null,
      title: item.title.trim().slice(0, 300),
      album: item.album?.trim().slice(0, 300) || null,
      match_status: resolution.status
    };
    const candidate = resolution.candidate;
    if (candidate) {
      row.matched_provider = candidate.provider.toLowerCase();
      row.matched_provider_track_id = String(candidate.providerTrackId).slice(0, 64);
      row.matched_title = candidate.title.slice(0, 300);
      row.matched_artist = candidate.artist.slice(0, 200);
      row.matched_audio_url = candidate.audioUrl || null;
      row.matched_artwork_url = candidate.artworkUrl;
      row.matched_license_url = candidate.licenseUrl || null;
      row.matched_source_url = candidate.sourceUrl || null;
      if (resolution.status === "matched") {
        matched += 1;
        const key = `${candidate.provider.toLowerCase()}:${candidate.providerTrackId}`;
        if (!matchedKeys.has(key)) {
          matchedKeys.add(key);
          matchedTracks.push(candidate);
          row.playlist_track_id = key;
        } else {
          // Honest duplicate handling: matched, but already present in the playlist.
          row.playlist_track_id = `${key} (duplicate)`;
        }
      } else {
        matchErrors += 1;
      }
    } else if (resolution.status === "error") {
      matchErrors += 1;
    } else {
      notFound += 1;
    }
    itemRows.push(row);
  }

  let playlist: { id: string; title: string } | null = null;
  let jobErrorText: string | null = null;
  if (matchedTracks.length > 0) {
    const label = (args.sourceLabel ?? args.sourceKind).replace(/\s+/g, " ").trim().slice(0, 44) || args.sourceKind;
    const title = `Imported ${label} ${new Date().toISOString().slice(0, 10)}`.slice(0, 80);
    const { data: created, error: createError } = await auth.client.from("playlists").insert({
      owner_id: auth.user.id,
      title,
      description: `SONORA import from ${args.sourceKind}${args.sourceUrl ? ` (${args.sourceUrl.slice(0, 180)})` : ""} — ${matchedTracks.length} licensed tracks matched`.slice(0, 500),
      is_public: false
    }).select("id,title").single();
    if (createError || !created) {
      request.log.error({ code: createError?.code }, "Import playlist creation failed");
      jobErrorText = isMissingRelation(createError) ? MIGRATIONS_MESSAGE : "The matched tracks were found but the SONORA playlist could not be created.";
    } else {
      const trackRows = matchedTracks.map((track, position) => ({
        playlist_id: created.id,
        provider: track.provider.toLowerCase(),
        provider_track_id: String(track.providerTrackId).slice(0, 64),
        title: track.title.slice(0, 300),
        artist_name: track.artist.slice(0, 200) || "Unknown artist",
        album_name: track.album?.slice(0, 300) ?? null,
        duration_seconds: typeof track.durationSeconds === "number" ? track.durationSeconds : null,
        artwork_url: track.artworkUrl,
        license_url: track.licenseUrl || (track.provider.toLowerCase() === "audius" ? "https://audius.co/terms" : "https://jamendo.com/legal/license"),
        source_url: track.sourceUrl || "https://www.jamendo.com",
        position
      }));
      const addError = await insertChunked(auth.client, "provider_playlist_tracks", trackRows);
      if (addError) {
        request.log.error({ code: addError.code }, "Import playlist tracks could not be attached");
        // Roll back the empty playlist rather than leaving a broken one behind.
        await auth.client.from("playlists").delete().eq("id", created.id).eq("owner_id", auth.user.id);
        jobErrorText = "Matched tracks could not be attached to the new playlist.";
      } else {
        playlist = { id: created.id, title: created.title };
      }
    }
  }

  const itemsError = await insertChunked(auth.client, "import_items", itemRows);
  if (itemsError && isMissingRelation(itemsError)) {
    request.log.error({ code: itemsError.code }, "import_items table missing");
    // The job row exists but item persistence failed; report honestly.
    await auth.client.from("import_jobs").update({ status: "failed", error: MIGRATIONS_MESSAGE }).eq("id", job.id);
    await reply.code(503).send({ ...authError(503, MIGRATIONS_MESSAGE), needsMigration: "008_import_jobs" });
    return;
  }
  if (itemsError) request.log.error({ code: itemsError.code }, "Import items could not all be stored");

  const status = jobErrorText || itemsError ? "failed" : "completed";
  await auth.client.from("import_jobs").update({ status, error: jobErrorText }).eq("id", job.id);

  await reply.code(201).send({
    ok: true,
    job: { ...job, status, error: jobErrorText },
    matched,
    notFound,
    ...(matchErrors ? { matchErrors } : {}),
    ...(truncated ? { truncated: true, processedItems: items.length } : {}),
    ...(args.note ? { note: args.note } : {}),
    playlist: playlist ? { id: playlist.id, name: playlist.title, title: playlist.title } : null
  });
}

function manualExportResponse(reply: FastifyReply, source: ParsedSource): void {
  reply.code(202).send({
    ok: true,
    needsManualExport: true,
    source,
    hint: source.hint ?? "No free public API exposes this playlist's track list. Use the platform's data export and upload the file via /api/v1/import/file."
  });
}

// ---------------------------------------------------------------------------
// Public per-source fetchers
// ---------------------------------------------------------------------------

async function importDeezer(request: FastifyRequest, reply: FastifyReply, auth: Auth, source: ParsedSource): Promise<void> {
  // Deezer's public JSON endpoint needs no key. We read metadata ONLY:
  // the 30s preview URLs it returns are deliberately never stored or used —
  // playback always comes from SONORA's matched licensed catalog.
  try {
    const payload = await fetchPublicJson(`https://api.deezer.com/playlist/${encodeURIComponent(String(source.externalId))}?limit=200`) as {
      title?: string;
      tracks?: { data?: Array<{ title?: string; artist?: { name?: string } | null; album?: { title?: string } | null }> };
    };
    const items: ImportListItem[] = (payload.tracks?.data ?? []).flatMap((track) =>
      track.title ? [{ artist: track.artist?.name ?? "", title: track.title, album: track.album?.title ?? null }] : []
    );
    if (!items.length) {
      await reply.code(404).send(authError(404, "This Deezer playlist is empty or not publicly readable."));
      return;
    }
    await executeImport(request, reply, auth, {
      sourceKind: "deezer", sourceUrl: source.canonicalUrl,
      sourceLabel: payload.title?.trim().slice(0, 200) || "Deezer playlist", items
    });
  } catch (error) {
    request.log.warn({ err: error }, "Deezer public playlist fetch failed");
    await reply.code(502).send(authError(502, "Deezer did not return this playlist. Check that the link is public and correct."));
  }
}

async function importJamendo(request: FastifyRequest, reply: FastifyReply, auth: Auth, source: ParsedSource): Promise<void> {
  const clientId = process.env.JAMENDO_CLIENT_ID;
  if (!clientId) {
    await reply.code(503).send(authError(503, "Jamendo catalog access is not configured on this server (JAMENDO_CLIENT_ID), so Jamendo playlists cannot be imported yet."));
    return;
  }
  try {
    const params = new URLSearchParams({
      client_id: clientId, format: "json", id: String(source.externalId),
      limit: "200", audioformat: "mp32", track_type: "single albumtrack", include: "licenses"
    });
    const payload = await fetchPublicJson(`https://api.jamendo.com/v3.0/playlists/tracks/?${params.toString()}`) as {
      results?: Array<{
        id: string; name?: string;
        tracks?: Array<{
          id: string; name: string; duration?: string | number; artist_name?: string;
          image?: string; album_image?: string; audio?: string; license_ccurl?: string;
        }>;
      }>;
    };
    const playlist = payload.results?.[0];
    const tracks = (playlist?.tracks ?? []).filter((track) => track?.id && track?.name);
    if (!tracks.length) {
      await reply.code(404).send(authError(404, "This Jamendo playlist is empty or not publicly readable."));
      return;
    }
    // A Jamendo playlist IS licensed-catalog content: attach directly, but
    // keep the same license allowlist the rest of SONORA enforces.
    const candidates: Array<JamendoCandidate | null> = tracks.map((track) => {
      const audioUrl = track.audio ?? "";
      if (!audioUrl || !isKnownCcLicense(track.license_ccurl ?? "")) return null;
      return {
        id: `jamendo:${track.id}`, providerTrackId: String(track.id), title: track.name,
        artist: track.artist_name ?? "Jamendo artist", album: null,
        durationSeconds: Number(track.duration) || null, genres: [],
        artworkUrl: track.album_image ?? track.image ?? null, audioUrl,
        licenseUrl: track.license_ccurl ?? "", sourceUrl: `https://www.jamendo.com/track/${track.id}`,
        provider: "Jamendo", playable: true
      };
    });
    const items: ImportListItem[] = tracks.map((track) => ({ artist: track.artist_name ?? "", title: track.name }));
    await executeImport(request, reply, auth, {
      sourceKind: "jamendo", sourceUrl: source.canonicalUrl,
      sourceLabel: playlist?.name?.trim().slice(0, 200) || "Jamendo playlist",
      items: items.slice(0, candidates.length),
      matcher: async (_item, index) => {
        const candidate = candidates[index] ?? null;
        return candidate ? { candidate, status: "matched" } : { candidate: null, status: "not_found" };
      },
      note: "Jamendo playlist tracks are already SONORA catalog content; unlicensed or unplayable entries are reported as not found."
    });
  } catch (error) {
    request.log.warn({ err: error }, "Jamendo playlist fetch failed");
    await reply.code(502).send(authError(502, "Jamendo did not return this playlist. Check that the link is public and correct."));
  }
}

async function importSoundCloud(request: FastifyRequest, reply: FastifyReply, auth: Auth, source: ParsedSource): Promise<void> {
  // Only the public oEmbed endpoint is used (no key): it exposes the set
  // title, never the track list. We record one honest item instead of
  // pretending to know the full playlist.
  try {
    const payload = await fetchPublicJson(
      `https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(source.canonicalUrl)}`
    ) as { title?: string; author_name?: string };
    const title = (payload.title ?? "").trim().slice(0, 300);
    if (!title) {
      await reply.code(404).send(authError(404, "SoundCloud did not expose this playlist title."));
      return;
    }
    await executeImport(request, reply, auth, {
      sourceKind: "soundcloud", sourceUrl: source.canonicalUrl,
      sourceLabel: `SoundCloud: ${title}`.slice(0, 200),
      items: [{ artist: (payload.author_name ?? "").trim().slice(0, 200), title }],
      note: "SoundCloud's public oEmbed only exposes the set title, so the title itself was matched against the licensed catalog. Export the full set and upload it via /api/v1/import/file for a complete import."
    });
  } catch (error) {
    request.log.warn({ err: error }, "SoundCloud oEmbed fetch failed");
    await reply.code(502).send(authError(502, "SoundCloud did not respond to the public oEmbed lookup."));
  }
}

async function importSpotify(request: FastifyRequest, reply: FastifyReply, auth: Auth, source: ParsedSource): Promise<void> {
  // Official client-credentials flow (operator-provided app credentials,
  // read-only public playlist metadata). This capability is optional and is
  // skipped whenever the env pair is absent.
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret || !source.externalId) {
    manualExportResponse(reply, source);
    return;
  }
  try {
    const tokenPayload = await fetchPublicJson("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`
      },
      body: "grant_type=client_credentials"
    }) as { access_token?: string };
    const accessToken = tokenPayload.access_token ?? "";
    if (!accessToken) throw new Error("Spotify returned no access token");
    const headers = { Authorization: `Bearer ${accessToken}` };
    const meta = await fetchPublicJson(
      `https://api.spotify.com/v1/playlists/${encodeURIComponent(String(source.externalId))}?fields=name`,
      { headers }
    ) as { name?: string };
    const items: ImportListItem[] = [];
    for (let offset = 0; offset < MAX_IMPORT_ITEMS; offset += 100) {
      const page = await fetchPublicJson(
        `https://api.spotify.com/v1/playlists/${encodeURIComponent(String(source.externalId))}/tracks?limit=100&offset=${offset}&additional_types=track`,
        { headers }
      ) as { items?: Array<{ track?: { name?: string; artists?: Array<{ name?: string }>; album?: { name?: string } | null } | null }> };
      const rows = page.items ?? [];
      for (const entry of rows) {
        const track = entry.track;
        if (!track?.name) continue;
        items.push({
          artist: (track.artists ?? []).map((artist) => artist.name ?? "").filter(Boolean).join(", ").slice(0, 200),
          title: track.name,
          album: track.album?.name ?? null
        });
        if (items.length >= MAX_IMPORT_ITEMS) break;
      }
      if (!rows.length || items.length >= MAX_IMPORT_ITEMS) break;
    }
    if (!items.length) {
      await reply.code(404).send(authError(404, "This Spotify playlist is empty or not publicly readable."));
      return;
    }
    await executeImport(request, reply, auth, {
      sourceKind: "spotify", sourceUrl: source.canonicalUrl,
      sourceLabel: (meta.name ?? "Spotify playlist").trim().slice(0, 200), items
    });
  } catch (error) {
    request.log.warn({ err: error }, "Spotify official playlist fetch failed");
    await reply.code(502).send(authError(502, "Spotify did not return this playlist. Check that the link is public and correct."));
  }
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function registerImportRoutes(app: FastifyInstance): void {

  app.post<{ Body: { url?: string } }>("/api/v1/import/link", writeRateLimit, async (request, reply) => {
    const auth = await requireUser(request, reply);
    if (!auth) return;
    const url = typeof request.body?.url === "string" ? request.body.url.trim().slice(0, 2048) : "";
    if (url.length < 8) {
      return reply.code(400).send(authError(400, "Provide a public playlist URL from a supported platform."));
    }
    const source = parseSourceUrl(url);
    if (source.kind === "unknown") {
      return reply.code(400).send(authError(400,
        "That link is not a recognized public playlist URL. Supported: Deezer, Spotify, Apple Music, YouTube Music, Yandex Music, VK, SoundCloud and Jamendo playlists — or upload a track-list export via /api/v1/import/file."));
    }
    if (source.needsManualExport) return manualExportResponse(reply, source);
    switch (source.kind) {
      case "deezer": return importDeezer(request, reply, auth, source);
      case "jamendo": return importJamendo(request, reply, auth, source);
      case "soundcloud": return importSoundCloud(request, reply, auth, source);
      case "spotify": return importSpotify(request, reply, auth, source);
      default:
        // apple (and any allowlisted kind without a keyless track API): the
        // honest answer is the export path, never a fabricated import.
        return manualExportResponse(reply, source);
    }
  });

  app.post<{ Body: { filename?: string; text?: string; playlistName?: string } }>(
    "/api/v1/import/file", writeRateLimit, async (request, reply) => {
      const auth = await requireUser(request, reply);
      if (!auth) return;
      const body = request.body ?? {};
      if (body.filename !== undefined && (typeof body.filename !== "string" || body.filename.length > 255)) {
        return reply.code(400).send(authError(400, "The file name is too long."));
      }
      if (body.playlistName !== undefined && (typeof body.playlistName !== "string" || body.playlistName.length > 120)) {
        return reply.code(400).send(authError(400, "The playlist name must be up to 120 characters."));
      }
      const text = typeof body.text === "string" ? body.text : "";
      if (text.trim().length < 2 || text.length > 2_000_000) {
        return reply.code(400).send(authError(400, "Provide the exported file contents as text (up to 2 MB)."));
      }

      let items: ImportListItem[] = [];
      let label: string | null = typeof body.playlistName === "string" ? body.playlistName.trim() : null;
      const trimmed = text.trim();
      if (trimmed.startsWith("{")) {
        const playlists = parseSpotifyExportJson(trimmed);
        const usable = playlists.find((playlist) => playlist.items.length > 0);
        if (!usable) {
          return reply.code(400).send(authError(400, "This JSON file is not a recognized Spotify export shape. Upload the file Spotify gave you under \"Your Data\", or convert the list to CSV."));
        }
        items = usable.items;
        label = label || usable.playlistName;
      } else {
        const parsed = parseGenericList(trimmed);
        items = parsed.items;
        label = label || parsed.playlistName;
      }
      if (!label && typeof body.filename === "string") {
        label = body.filename.replace(/\.[A-Za-z0-9]+$/, "").slice(0, 120);
      }
      if (!items.length) {
        return reply.code(400).send(authError(400, "No track rows could be parsed. Expect CSV/TSV with title and artist columns, one \"Artist - Title\" per line, or a Spotify data export JSON."));
      }
      return executeImport(request, reply, auth, {
        sourceKind: "file_generic",
        sourceUrl: null,
        sourceLabel: (label || "Manual track list").slice(0, 200),
        items
      });
    }
  );

  app.get("/api/v1/import/jobs", writeRateLimit, async (request, reply) => {
    const auth = await requireUser(request, reply);
    if (!auth) return;
    const { data, error } = await auth.client.from("import_jobs")
      .select("id,source_kind,source_url,source_label,status,error,created_at,import_items(count)")
      .eq("user_id", auth.user.id).order("created_at", { ascending: false }).limit(20);
    if (error) {
      request.log.error({ code: error.code, message: error.message }, "Import job listing failed");
      if (isMissingRelation(error)) {
        return reply.code(503).send({ ...authError(503, MIGRATIONS_MESSAGE), needsMigration: "008_import_jobs" });
      }
      return reply.code(503).send(authError(503, "Import jobs are temporarily unavailable."));
    }
    return {
      items: (data ?? []).map((row: Record<string, unknown>) => {
        const { import_items, ...job } = row;
        const countEntry = Array.isArray(import_items) ? import_items[0] as { count?: number } : undefined;
        return { ...job, itemCount: countEntry?.count ?? 0 };
      })
    };
  });

  app.get<{ Params: { id: string } }>("/api/v1/import/jobs/:id", writeRateLimit, async (request, reply) => {
    const auth = await requireUser(request, reply);
    if (!auth) return;
    const jobId = request.params.id;
    if (!UUID_PATTERN.test(jobId)) {
      return reply.code(400).send(authError(400, "A valid import job ID is required."));
    }
    const { data: job, error } = await auth.client.from("import_jobs")
      .select("id,user_id,source_kind,source_url,source_label,status,error,created_at")
      .eq("id", jobId).maybeSingle();
    if (error) {
      request.log.error({ code: error.code }, "Import job lookup failed");
      if (isMissingRelation(error)) {
        return reply.code(503).send({ ...authError(503, MIGRATIONS_MESSAGE), needsMigration: "008_import_jobs" });
      }
      return reply.code(503).send(authError(503, "Import jobs are temporarily unavailable."));
    }
    if (!job) return reply.code(404).send(authError(404, "Import job not found."));
    const { data: items, error: itemsError } = await auth.client.from("import_items")
      .select("id,position,artist,title,album,matched_provider,matched_provider_track_id,matched_title,matched_artist,matched_audio_url,matched_artwork_url,matched_license_url,matched_source_url,match_status,playlist_track_id")
      .eq("job_id", jobId).order("position", { ascending: true }).limit(MAX_IMPORT_ITEMS);
    if (itemsError) request.log.warn({ code: itemsError.code }, "Import item listing failed");
    return { job, items: items ?? [] };
  });
}
