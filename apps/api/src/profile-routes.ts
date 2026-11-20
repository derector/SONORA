import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { SupabaseClient } from "@supabase/supabase-js";

// SONORA Profile Center v2 API surface.
// Every field in a response maps to a stored column or a counted row. Where
// the catalog carries no information (genre tags, BPM) the endpoint says so
// instead of inventing a number.

export type ProfileRouteDeps = {
  authClient: (accessToken?: string) => SupabaseClient;
  requireUser: (
    request: FastifyRequest,
    reply: FastifyReply
  ) => Promise<{ client: SupabaseClient; user: { id: string } } | null>;
  authError: (statusCode: number, message: string) => { statusCode: number; error: string };
};

/** Built-in cover gradients; the same ids are rendered by the web presets. */
export const ACCENT_PRESETS = ["aurora", "violet", "ocean", "sunset", "forest", "mono"] as const;
export const PROFILE_ROLES = ["listener", "creator", "curator", "dj"] as const;
export const PROFILE_COLUMNS =
  "id,email,username,display_name,avatar_url,cover_url,bio,accent,role,status,links,privacy,favorite_genres,created_at,updated_at";

const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"
};
export const USERNAME_PATTERN = /^[a-z0-9_]{3,24}$/;

export type LinkItem = { platform: string; url: string };
export type Privacy = { history: boolean; profile: "public" | "private"; comments: boolean };
export const DEFAULT_PRIVACY: Privacy = { history: true, profile: "public", comments: true };

export type LinkResult = { items: LinkItem[] } | { error: string };
export type PrivacyResult = { privacy: Privacy } | { error: string };
export type GenreResult = { genres: string[] } | { error: string };

export function normalizeLinks(value: unknown): LinkResult {
  if (value === undefined || value === null) return { items: [] };
  if (!Array.isArray(value)) return { error: "Links must be a list of {platform, url} entries." };
  if (value.length > 6) return { error: "Keep six social links or fewer." };
  const items: LinkItem[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") return { error: "Each link needs a platform and a URL." };
    const candidate = entry as { platform?: unknown; url?: unknown };
    const platform = typeof candidate.platform === "string" ? candidate.platform.trim().slice(0, 24) : "";
    const url = typeof candidate.url === "string" ? candidate.url.trim() : "";
    if (!platform) return { error: "Each link needs a platform label." };
    if (!isPublicHttpsUrl(url)) return { error: "Link URLs must be public https addresses." };
    items.push({ platform, url });
  }
  return { items };
}

export function normalizePrivacy(value: unknown): PrivacyResult {
  if (value === undefined || value === null) return { privacy: { ...DEFAULT_PRIVACY } };
  if (typeof value !== "object" || Array.isArray(value)) return { error: "Privacy must be an object." };
  const input = value as Record<string, unknown>;
  const history = input.history ?? DEFAULT_PRIVACY.history;
  const comments = input.comments ?? DEFAULT_PRIVACY.comments;
  const profile = input.profile ?? DEFAULT_PRIVACY.profile;
  if (typeof history !== "boolean") return { error: "History privacy must be on or off." };
  if (typeof comments !== "boolean") return { error: "Comment privacy must be on or off." };
  if (profile !== "public" && profile !== "private") return { error: "Profile visibility is public or private." };
  return { privacy: { history, profile, comments } };
}

export function normalizeGenres(value: unknown): GenreResult {
  if (value === undefined || value === null) return { genres: [] };
  if (!Array.isArray(value)) return { error: "Genres must be a list of short labels." };
  const genres: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") return { error: "Genres must be a list of short labels." };
    const label = entry.trim().slice(0, 32);
    if (!label) continue;
    if (!genres.includes(label)) genres.push(label);
    if (genres.length > 12) return { error: "Keep twelve genres or fewer." };
  }
  return { genres };
}

export function isPublicHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048 || !value.startsWith("https://")) return false;
  try {
    const parsed = new URL(value);
    const host = parsed.hostname;
    if (!host || parsed.protocol !== "https:") return false;
    if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return false;
    if (/^(10\.|127\.|0\.)/.test(host) || /^192\.168\./.test(host)) return false;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
    if (host.startsWith("[::1]") || /^f[cd]/i.test(host) || /^fe80/i.test(host)) return false;
    return true;
  } catch {
    return false;
  }
}

function linksOr(value: unknown): LinkItem[] {
  const result = normalizeLinks(value);
  return "items" in result ? result.items : [];
}
function privacyOr(value: unknown): Privacy {
  const result = normalizePrivacy(value);
  return "privacy" in result ? result.privacy : { ...DEFAULT_PRIVACY };
}
function genresOr(value: unknown): string[] {
  const result = normalizeGenres(value);
  return "genres" in result ? result.genres : [];
}

export function mapProfile(row: Record<string, unknown>) {
  return {
    id: row.id, email: row.email, username: row.username,
    displayName: row.display_name, avatarUrl: row.avatar_url ?? null,
    coverUrl: row.cover_url ?? null, bio: row.bio ?? null,
    accent: row.accent ?? null, role: row.role ?? null, status: row.status ?? null,
    links: linksOr(row.links),
    privacy: privacyOr(row.privacy),
    favoriteGenres: genresOr(row.favorite_genres),
    createdAt: row.created_at, updatedAt: row.updated_at ?? null
  };
}

const BASE_PROFILE_COLUMNS = "id,email,username,display_name,avatar_url,created_at";

/**
 * Reads one profile row, tolerating deployments where migration 010 has not
 * landed yet: the Profile Center columns are simply reported as defaults.
 */
export async function readProfile(client: SupabaseClient, userId: string) {
  const full = await client.from("users").select(PROFILE_COLUMNS).eq("id", userId).single();
  if (!full.error && full.data) {
    return { user: mapProfile(full.data as unknown as Record<string, unknown>), partial: false };
  }
  const base = await client.from("users").select(BASE_PROFILE_COLUMNS).eq("id", userId).single();
  if (base.error || !base.data) return { user: null, partial: true };
  return { user: mapProfile(base.data as unknown as Record<string, unknown>), partial: true };
}

// ---------------------------------------------------------------------------
// Abuse protection. @fastify/rate-limit is not a dependency on this branch,
// so the presets used by the API lane (10/15/60/120/300 per minute) are
// enforced with a bounded in-memory window keyed by route + client IP.
// ---------------------------------------------------------------------------
type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

function windowLimit(name: string, max: number, windowMs = 60_000) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const now = Date.now();
    const key = `${name}:${request.ip}`;
    if (buckets.size > 8000) {
      for (const [existing, value] of buckets) if (value.resetAt <= now) buckets.delete(existing);
    }
    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return;
    }
    bucket.count += 1;
    if (bucket.count > max) {
      request.log.warn({ route: name }, "Profile center rate limit reached");
      await reply.code(429).send({ statusCode: 429, error: "Too many requests, please slow down." });
    }
  };
}

// ---------------------------------------------------------------------------
// Taste scoring. Kept local and deterministic so the profile endpoints do not
// depend on another lane's in-flight module. The weights mirror the shared
// recommendation core: liked +2.2, skipped -2.5, plays capped at +1.2.
// ---------------------------------------------------------------------------
export type TasteSignal = {
  artist?: string;
  genres?: string[];
  liked?: boolean;
  skipped?: boolean;
  plays?: number;
};

/** Shared text normalizer: lowercase, ё→е, accent/punctuation folding. */
export const normalizeText = (value: string) =>
  value.normalize("NFKD").toLowerCase().replace(/[ё]/g, "е").replace(/[^a-zа-я0-9]+/g, " ").trim();

export function artistAffinity(signals: TasteSignal[]) {
  const weights = new Map<string, number>();
  for (const signal of signals) {
    const key = normalizeText(signal.artist ?? "");
    if (!key) continue;
    const weight = signal.skipped ? -2.5 : signal.liked ? 2.2 : Math.min(1.2, (signal.plays ?? 0) * 0.12);
    weights.set(key, (weights.get(key) ?? 0) + weight);
  }
  return weights;
}

export function genreAffinity(signals: TasteSignal[]) {
  const weights = new Map<string, number>();
  for (const signal of signals) {
    const weight = signal.skipped ? -2.5 : signal.liked ? 2.2 : Math.min(1.2, (signal.plays ?? 0) * 0.12);
    for (const genre of signal.genres ?? []) {
      const key = normalizeText(genre);
      if (key) weights.set(key, (weights.get(key) ?? 0) + weight);
    }
  }
  return weights;
}

export function buildTasteSignals(
  rows: EventRow[],
  likedArtists: string[],
  skippedArtists: string[],
  declaredGenres: string[]
): TasteSignal[] {
  const signals: TasteSignal[] = [];
  for (const artist of likedArtists) signals.push({ artist, liked: true, genres: declaredGenres });
  for (const artist of skippedArtists) signals.push({ artist, skipped: true });
  const plays = new Map<string, number>();
  for (const row of rows) plays.set(row.artist, (plays.get(row.artist) ?? 0) + 1);
  for (const [artist, count] of plays) signals.push({ artist, plays: count });
  return signals;
}

// ---------------------------------------------------------------------------
// Listening aggregation over provider events + first-party catalog events.
// Provider numeric IDs are never mixed into catalog queries.
// ---------------------------------------------------------------------------
export type EventRow = {
  artist: string;
  title: string;
  minutes: number;
  occurredAt: string;
  event: string;
  genre: string | null;
  trackKey: string;
};

const dayKey = (value: string) => value.slice(0, 10);
const monthKey = (value: string) => value.slice(0, 7);
const minutesOf = (ms: number) => Math.max(0, Math.round(ms / 6000) / 100);
const round2 = (value: number) => Math.round(value * 100) / 100;

async function providerEvents(client: SupabaseClient, userId: string, sinceIso: string): Promise<EventRow[]> {
  const base = "artist_name,title,event_type,listened_ms,occurred_at,provider_track_id";
  // Loosely typed on purpose: the two attempts differ by one projected column
  // and PostgREST generics would refuse the retry assignment.
  type RowsResult = { data: unknown; error: unknown };
  let result: RowsResult = await client.from("provider_listening_events")
    .select(`${base},genre`)
    .eq("user_id", userId).gte("occurred_at", sinceIso)
    .order("occurred_at", { ascending: false }).limit(2000);
  // The genre column only exists once migration 010 is applied: retry without
  // it instead of failing the whole stats request.
  if (result.error) {
    result = await client.from("provider_listening_events")
      .select(base)
      .eq("user_id", userId).gte("occurred_at", sinceIso)
      .order("occurred_at", { ascending: false }).limit(2000);
  }
  if (result.error) return [];
  return ((result.data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    artist: String(row.artist_name ?? "Unknown artist"),
    title: String(row.title ?? ""),
    minutes: minutesOf(Number(row.listened_ms ?? 0)),
    occurredAt: String(row.occurred_at ?? ""),
    event: String(row.event_type ?? "play"),
    genre: typeof row.genre === "string" ? row.genre : null,
    trackKey: `jamendo:${row.provider_track_id ?? ""}`
  }));
}

async function catalogEvents(client: SupabaseClient, userId: string, sinceIso: string): Promise<EventRow[]> {
  const result = await client.from("listening_events")
    .select("event_type,listened_ms,occurred_at,track:tracks(id,title,artist:artists(name))")
    .eq("user_id", userId).gte("occurred_at", sinceIso)
    .order("occurred_at", { ascending: false }).limit(1000);
  if (result.error) return [];
  return ((result.data ?? []) as Array<Record<string, unknown>>).map((row) => {
    const track = row.track as { id?: string; title?: string; artist?: { name?: string } | null } | null;
    return {
      artist: String(track?.artist?.name ?? "Unknown artist"),
      title: String(track?.title ?? ""),
      minutes: minutesOf(Number(row.listened_ms ?? 0)),
      occurredAt: String(row.occurred_at ?? ""),
      event: String(row.event_type ?? "play"),
      genre: null,
      trackKey: `catalog:${track?.id ?? "unknown"}`
    };
  });
}

export async function collectEvents(client: SupabaseClient, userId: string, sinceIso: string) {
  const [provider, catalog] = await Promise.all([
    providerEvents(client, userId, sinceIso),
    catalogEvents(client, userId, sinceIso)
  ]);
  return [...provider, ...catalog];
}

export function summarizeEvents(rows: EventRow[], now = new Date()) {
  const byArtist = new Map<string, { events: number; minutes: number }>();
  const byGenre = new Map<string, number>();
  const byDay = new Map<string, number>();
  const byMonth = new Map<string, number>();
  const weekStart = new Date(now.getTime() - 7 * 86_400_000).getTime();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  let weekMinutes = 0;
  let monthMinutes = 0;
  let totalMinutes = 0;
  for (const row of rows) {
    const at = new Date(row.occurredAt).getTime();
    if (!Number.isFinite(at)) continue;
    const artist = byArtist.get(row.artist) ?? { events: 0, minutes: 0 };
    artist.events += 1;
    artist.minutes = round2(artist.minutes + row.minutes);
    byArtist.set(row.artist, artist);
    if (row.genre) byGenre.set(row.genre, (byGenre.get(row.genre) ?? 0) + 1);
    const day = dayKey(row.occurredAt);
    byDay.set(day, round2((byDay.get(day) ?? 0) + row.minutes));
    const month = monthKey(row.occurredAt);
    byMonth.set(month, round2((byMonth.get(month) ?? 0) + row.minutes));
    totalMinutes = round2(totalMinutes + row.minutes);
    if (at >= weekStart) weekMinutes = round2(weekMinutes + row.minutes);
    if (at >= monthStart) monthMinutes = round2(monthMinutes + row.minutes);
  }
  const topArtists = [...byArtist.entries()]
    .map(([name, value]) => ({ name, events: value.events, minutes: value.minutes }))
    .sort((a, b) => b.events - a.events || b.minutes - a.minutes)
    .slice(0, 5);
  const topGenres = [...byGenre.entries()]
    .map(([name, events]) => ({ name, events }))
    .sort((a, b) => b.events - a.events)
    .slice(0, 5);
  // Streak: consecutive days with at least one minute listened, ending today
  // or yesterday. A gap stops it; nothing is rounded in the user's favour.
  const activeDays = new Set([...byDay.entries()].filter(([, minutes]) => minutes > 0).map(([day]) => day));
  let streak = 0;
  const cursor = new Date(now);
  if (!activeDays.has(cursor.toISOString().slice(0, 10))) cursor.setUTCDate(cursor.getUTCDate() - 1);
  while (streak < 3650 && activeDays.has(cursor.toISOString().slice(0, 10))) {
    streak += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  const daily = [...byDay.entries()]
    .map(([date, minutes]) => ({ date, minutes }))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-28);
  const monthly = [...byMonth.entries()]
    .map(([month, minutes]) => ({ month, minutes }))
    .sort((a, b) => a.month.localeCompare(b.month))
    .slice(-12);
  return {
    topArtists, topGenres, daily, monthly, streak,
    weekMinutes, monthMinutes, totalMinutes, artistCount: byArtist.size
  };
}

const ENERGY_FLAGS = ["loud", "party", "electronic", "happy", "new"] as const;
const CALM_FLAGS = ["relaxing", "sad", "acoustic", "spoken"] as const;

export type MusicInfoTrack = { id: string; plays: number; info: Record<string, unknown> | null };

/**
 * Averages Jamendo's musicinfo mood flags by play count. Jamendo publishes no
 * BPM, so tempo is a labelled mood band and the bpm field stays null by design.
 */
export function moodFromMusicInfo(tracks: MusicInfoTrack[]) {
  let weight = 0;
  let energySum = 0;
  let tempoSum = 0;
  let sample = 0;
  const truthy = (value: unknown) => {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value > 0;
    if (typeof value === "string") return /^(1|true|yes)$/i.test(value);
    return false;
  };
  for (const track of tracks) {
    if (!track.info) continue;
    let energetic = 0;
    for (const flag of ENERGY_FLAGS) if (truthy(track.info[flag])) energetic += 1;
    let calm = 0;
    for (const flag of CALM_FLAGS) if (truthy(track.info[flag])) calm += 1;
    if (!energetic && !calm) continue;
    const plays = Math.max(1, track.plays);
    sample += 1;
    weight += plays;
    energySum += plays * Math.max(0, Math.min(1, 0.5 + (energetic - calm) / 2));
    tempoSum += plays * (energetic > calm ? (energetic > 2 ? 0.85 : 0.65) : calm > 2 ? 0.2 : 0.4);
  }
  if (!weight || !sample) return { energy: null, tempo: null, sample: 0 };
  return { energy: round2(energySum / weight), tempo: round2(tempoSum / weight), sample };
}

export function tempoBand(tempo: number | null) {
  if (tempo === null) return null;
  if (tempo >= 0.8) return "fast";
  if (tempo >= 0.55) return "moderate";
  if (tempo >= 0.35) return "mid-tempo";
  return "slow";
}

/** Maps track_feedback keys back to artist names using already-loaded rows. */
export function feedbackArtists(
  feedback: Array<{ kind: string; track_key: string }>,
  rows: EventRow[]
) {
  const byKey = new Map<string, string>();
  for (const row of rows) if (row.trackKey && row.artist) byKey.set(row.trackKey, row.artist);
  const liked: string[] = [];
  const disliked: string[] = [];
  for (const entry of feedback) {
    const artist = byKey.get(entry.track_key);
    if (!artist) continue;
    if (entry.kind === "like" && !liked.includes(artist)) liked.push(artist);
    if (entry.kind === "dislike" && !disliked.includes(artist)) disliked.push(artist);
  }
  return { liked, disliked };
}

async function safeCount(client: SupabaseClient, table: string, column: string, filter: string, value: string) {
  const result = await client.from(table).select(column, { count: "exact", head: true }).eq(filter, value);
  return result.error ? 0 : result.count ?? 0;
}

// ---------------------------------------------------------------------------
// Route registration.
// ---------------------------------------------------------------------------
export function registerProfileRoutes(app: FastifyInstance, deps: ProfileRouteDeps) {
  const { authClient, requireUser, authError } = deps;
  const uploadLimit = { preHandler: windowLimit("profile-upload", 12) };
  const writeLimit = { preHandler: windowLimit("profile-write", 60) };
  const socialLimit = { preHandler: windowLimit("profile-social", 60) };
  const readLimit = { preHandler: windowLimit("profile-read", 120) };
  const searchLimit = { preHandler: windowLimit("profile-search", 30) };

  /** Signed-in viewer id, or null for anonymous or unverifiable callers. */
  async function viewerId(request: FastifyRequest): Promise<string | null> {
    const authorization = request.headers.authorization;
    const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
    if (!token) return null;
    try {
      const { data } = await authClient().auth.getUser(token);
      return data.user?.id ?? null;
    } catch {
      return null;
    }
  }

  async function publicTarget(request: FastifyRequest, reply: FastifyReply) {
    const username = String((request.params as { username?: string }).username ?? "").toLowerCase();
    if (!USERNAME_PATTERN.test(username)) {
      await reply.code(400).send(authError(400, "That username is not valid."));
      return null;
    }
    const { data, error } = await authClient().from("public_profiles")
      .select("id,username,display_name,avatar_url,cover_url,accent,role,status,bio,links,favorite_genres,created_at,visibility,show_history")
      .eq("username", username).maybeSingle();
    if (error) {
      request.log.error({ code: error.code, message: error.message }, "Public profile lookup failed");
      await reply.code(503).send(authError(503, "Profiles are temporarily unavailable."));
      return null;
    }
    if (!data) {
      await reply.code(404).send(authError(404, "No such profile."));
      return null;
    }
    return data as Record<string, unknown> & { id: string; username: string; visibility: string };
  }

  // ----- cover upload / remove -------------------------------------------
  app.post<{ Body: { contentType?: string; base64?: string } }>(
    "/api/v1/profile/cover", uploadLimit, async (request, reply) => {
      const auth = await requireUser(request, reply);
      if (!auth) return;
      const { contentType, base64 } = request.body ?? {};
      const extension = contentType ? IMAGE_EXTENSIONS[contentType] : undefined;
      if (!extension || typeof base64 !== "string" || base64.length < 16 ||
          base64.length > 4_200_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
        return reply.code(400).send(authError(400, "Choose a JPG, PNG or WebP image up to 3 MB."));
      }
      const image = Buffer.from(base64, "base64");
      if (!image.length || image.length > 3 * 1024 * 1024) {
        return reply.code(400).send(authError(400, "The cover image must be 3 MB or smaller."));
      }
      const path = `${auth.user.id}/cover.${extension}`;
      const { error: uploadError } = await auth.client.storage
        .from("sonora-covers").upload(path, image, { contentType, upsert: true, cacheControl: "3600" });
      if (uploadError) {
        request.log.error({ message: uploadError.message }, "Cover upload failed");
        return reply.code(400).send(authError(400,
          uploadError.message.toLowerCase().includes("bucket")
            ? "The cover storage bucket is not provisioned yet (migration 010)."
            : "Could not upload the cover image. Try another image."));
      }
      const { data: publicData } = auth.client.storage.from("sonora-covers").getPublicUrl(path);
      const coverUrl = `${publicData.publicUrl}?v=${Date.now()}`;
      const { data, error } = await auth.client.from("users")
        .update({ cover_url: coverUrl, updated_at: new Date().toISOString() })
        .eq("id", auth.user.id).select(PROFILE_COLUMNS).single();
      if (error || !data) {
        request.log.error({ code: error?.code }, "Cover profile update failed");
        return reply.code(400).send(authError(400, "Cover uploaded but the profile could not be updated."));
      }
      return { user: mapProfile(data as Record<string, unknown>) };
    }
  );

  app.delete("/api/v1/profile/cover", uploadLimit, async (request, reply) => {
    const auth = await requireUser(request, reply);
    if (!auth) return;
    await auth.client.storage.from("sonora-covers")
      .remove(["jpg", "png", "webp"].map((extension) => `${auth.user.id}/cover.${extension}`));
    const { data, error } = await auth.client.from("users")
      .update({ cover_url: null, updated_at: new Date().toISOString() })
      .eq("id", auth.user.id).select(PROFILE_COLUMNS).single();
    if (error || !data) return reply.code(400).send(authError(400, "Could not remove the cover image."));
    return { user: mapProfile(data as Record<string, unknown>) };
  });

  app.delete("/api/v1/profile/avatar", uploadLimit, async (request, reply) => {
    const auth = await requireUser(request, reply);
    if (!auth) return;
    const { data: listed } = await auth.client.storage.from("sonora-avatars").list(auth.user.id, { limit: 20 });
    const objects = ((listed ?? []) as Array<{ name: string }>).map((entry) => `${auth.user.id}/${entry.name}`);
    if (objects.length) await auth.client.storage.from("sonora-avatars").remove(objects);
    const { data, error } = await auth.client.from("users")
      .update({ avatar_url: null, updated_at: new Date().toISOString() })
      .eq("id", auth.user.id).select(PROFILE_COLUMNS).single();
    if (error || !data) return reply.code(400).send(authError(400, "Could not remove the avatar."));
    return { user: mapProfile(data as Record<string, unknown>) };
  });

  // ----- own stats --------------------------------------------------------
  app.get("/api/v1/profile/stats", readLimit, async (request, reply) => {
    const auth = await requireUser(request, reply);
    if (!auth) return;
    const since = new Date(Date.now() - 180 * 86_400_000).toISOString();
    const [rows, profile, favoriteRows, providerFavorites, catalogFavorites, playlists, followers, following, feedback] = await Promise.all([
      collectEvents(auth.client, auth.user.id, since),
      auth.client.from("users").select(PROFILE_COLUMNS).eq("id", auth.user.id).maybeSingle(),
      auth.client.from("user_provider_favorites")
        .select("artist_name,album_name,title,provider_track_id,artwork_url").eq("user_id", auth.user.id).limit(500),
      safeCount(auth.client, "user_provider_favorites", "user_id", "user_id", auth.user.id),
      safeCount(auth.client, "user_favorites", "user_id", "user_id", auth.user.id),
      safeCount(auth.client, "playlists", "owner_id", "owner_id", auth.user.id),
      safeCount(auth.client, "user_follows", "follower_id", "followee_id", auth.user.id),
      safeCount(auth.client, "user_follows", "followee_id", "follower_id", auth.user.id),
      safeCount(auth.client, "track_feedback", "user_id", "user_id", auth.user.id)
    ]);
    if (profile.error) request.log.warn({ code: profile.error.code }, "Profile stats lookup failed");
    const summary = summarizeEvents(rows);
    // Albums are favorites grouped by album name: the catalog has no album rows
    // for provider tracks, so this is the honest grouping available today.
    const albums = new Map<string, { title: string; artist: string; tracks: number; artworkUrl: string | null }>();
    for (const row of (favoriteRows.data ?? []) as Array<Record<string, unknown>>) {
      const title = String(row.album_name ?? "").trim();
      if (!title) continue;
      const key = `${String(row.artist_name ?? "")}::${title}`;
      const existing = albums.get(key);
      if (existing) existing.tracks += 1;
      else albums.set(key, {
        title, artist: String(row.artist_name ?? "Unknown artist"), tracks: 1,
        artworkUrl: (row.artwork_url as string | null) ?? null
      });
    }
    return {
      windowDays: 180,
      counts: {
        events: rows.length,
        favorites: providerFavorites,
        catalogFavorites,
        playlists,
        followers,
        following,
        feedback,
        artists: summary.artistCount,
        albums: albums.size
      },
      minutes: { week: summary.weekMinutes, month: summary.monthMinutes, total: summary.totalMinutes },
      streakDays: summary.streak,
      topArtists: summary.topArtists,
      topGenres: summary.topGenres,
      declaredGenres: genresOr((profile.data as Record<string, unknown> | null)?.favorite_genres),
      daily: summary.daily,
      monthly: summary.monthly,
      albums: [...albums.values()].sort((a, b) => b.tracks - a.tracks).slice(0, 24)
    };
  });

  // ----- AI taste profile -------------------------------------------------
  app.get("/api/v1/profile/taste", readLimit, async (request, reply) => {
    const auth = await requireUser(request, reply);
    if (!auth) return;
    const since = new Date(Date.now() - 180 * 86_400_000).toISOString();
    const [rows, favorites, skipped, feedback, profile] = await Promise.all([
      collectEvents(auth.client, auth.user.id, since),
      auth.client.from("user_provider_favorites").select("artist_name").eq("user_id", auth.user.id).limit(300),
      auth.client.from("provider_listening_events").select("artist_name")
        .eq("user_id", auth.user.id).eq("event_type", "skip").lt("listened_ms", 20000).limit(300),
      auth.client.from("track_feedback").select("kind,track_key").eq("user_id", auth.user.id).limit(500),
      auth.client.from("users").select(PROFILE_COLUMNS).eq("id", auth.user.id).maybeSingle()
    ]);
    const declaredGenres = genresOr((profile.data as Record<string, unknown> | null)?.favorite_genres);
    const resolved = feedbackArtists(
      (feedback.data ?? []) as Array<{ kind: string; track_key: string }>, rows
    );
    const likedArtists = [...new Set([
      ...(favorites.data ?? []).map((row: { artist_name: string }) => row.artist_name),
      ...resolved.liked
    ])].filter(Boolean);
    const skippedArtists = [...new Set([
      ...(skipped.data ?? []).map((row: { artist_name: string }) => row.artist_name),
      ...resolved.disliked
    ])].filter(Boolean);
    const signals = buildTasteSignals(rows, likedArtists, skippedArtists, declaredGenres);
    const affinity = artistAffinity(signals);
    const genreWeights = genreAffinity(signals);
    const summary = summarizeEvents(rows);

    const playsByTrack = new Map<string, number>();
    for (const row of rows) {
      const id = row.trackKey.startsWith("jamendo:") ? row.trackKey.slice(8) : "";
      if (/^[0-9]{1,24}$/.test(id)) playsByTrack.set(id, (playsByTrack.get(id) ?? 0) + 1);
    }
    const topTrackIds = [...playsByTrack.entries()]
      .sort((a, b) => b[1] - a[1]).slice(0, 40).map(([id]) => id);

    let mood = { energy: null as number | null, tempo: null as number | null, sample: 0 };
    let moodError: string | null = null;
    const clientId = process.env.JAMENDO_CLIENT_ID;
    const configured = process.env.JAMENDO_USE_MODE === "noncommercial" ||
      process.env.JAMENDO_COMMERCIAL_APPROVED === "true";
    if (clientId && configured && topTrackIds.length) {
      try {
        const params = new URLSearchParams({
          client_id: clientId, format: "json", id: topTrackIds.join(","),
          include: "musicinfo", limit: "50"
        });
        const response = await fetch(`https://api.jamendo.com/v3.0/tracks/?${params.toString()}`, {
          headers: { Accept: "application/json" }, signal: AbortSignal.timeout(9000)
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json() as { results?: Array<Record<string, unknown> & { id?: string }> };
        mood = moodFromMusicInfo((payload.results ?? [])
          .map((info) => ({
            id: String(info.id ?? ""),
            plays: playsByTrack.get(String(info.id ?? "")) ?? 1,
            info
          }))
          .filter((entry) => entry.id));
      } catch (error) {
        request.log.warn({ err: error }, "Jamendo musicinfo mood lookup failed");
        moodError = "Provider mood metadata is unavailable right now.";
      }
    } else if (!clientId || !configured) {
      moodError = "Music metadata access is not configured on this deployment.";
    } else if (!topTrackIds.length) {
      moodError = "There is not enough listening history yet.";
    }
    const measuredGenres = summary.topGenres.slice(0, 8);
    return {
      windowDays: 180,
      signals: {
        events: rows.length,
        favorites: (favorites.data ?? []).length,
        skips: (skipped.data ?? []).length,
        feedbackCount: (feedback.data ?? []).length,
        artists: summary.artistCount
      },
      genres: {
        declared: declaredGenres,
        measured: measuredGenres,
        weighted: [...genreWeights.entries()]
          .filter(([, weight]) => weight > 0)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 8)
          .map(([name, weight]) => ({ name, weight: round2(weight) })),
        // Genre tags are only published by some catalog rows; when they are
        // absent the honest answer is "declared only".
        source: measuredGenres.length ? "listening" : declaredGenres.length ? "declared" : "none",
        note: measuredGenres.length ? null
          : declaredGenres.length ? "Based on the genres you picked, not on tagged audio."
            : "No genre tags are available for your listens yet."
      },
      artistAffinity: [...affinity.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
        .map(([artist, weight]) => ({ artist, weight: round2(weight) })),
      energy: mood.energy,
      tempo: mood.tempo,
      tempoBand: tempoBand(mood.tempo),
      bpm: null,
      bpmNote: "Catalog metadata does not publish BPM, so tempo is reported as a mood band.",
      moodSample: mood.sample,
      moodError,
      topArtists: summary.topArtists,
      minutes: { week: summary.weekMinutes, month: summary.monthMinutes },
      declared: {
        accent: (profile.data as Record<string, unknown> | null)?.accent ?? null,
        role: (profile.data as Record<string, unknown> | null)?.role ?? null,
        status: (profile.data as Record<string, unknown> | null)?.status ?? null
      }
    };
  });

  // ----- track feedback ---------------------------------------------------
  app.post<{ Body: { trackKey?: string; kind?: string } }>(
    "/api/v1/feedback", writeLimit, async (request, reply) => {
      const auth = await requireUser(request, reply);
      if (!auth) return;
      const { trackKey, kind } = request.body ?? {};
      if (typeof trackKey !== "string" || trackKey.trim().length < 1 || trackKey.length > 160 ||
          (kind !== "like" && kind !== "dislike")) {
        return reply.code(400).send(authError(400, "Provide a track key and a like or dislike verdict."));
      }
      const { error } = await auth.client.from("track_feedback").upsert({
        user_id: auth.user.id, track_key: trackKey.trim(), kind, updated_at: new Date().toISOString()
      }, { onConflict: "user_id,track_key" });
      if (error) {
        request.log.warn({ code: error.code }, "Track feedback could not be saved");
        return reply.code(400).send(authError(400,
          error.code === "42P01"
            ? "Feedback storage is not provisioned yet (migration 010)."
            : "Your feedback could not be saved."));
      }
      return reply.code(201).send({ ok: true, trackKey: trackKey.trim(), kind });
    }
  );

  app.delete<{ Params: { trackKey: string } }>(
    "/api/v1/feedback/:trackKey", writeLimit, async (request, reply) => {
      const auth = await requireUser(request, reply);
      if (!auth) return;
      const { data, error } = await auth.client.from("track_feedback").delete()
        .eq("user_id", auth.user.id).eq("track_key", request.params.trackKey).select("id").maybeSingle();
      if (error) return reply.code(400).send(authError(400, "Feedback could not be cleared."));
      if (!data) return reply.code(404).send(authError(404, "No stored feedback for that track."));
      return { ok: true };
    }
  );

  // ----- people autocomplete ----------------------------------------------
  app.get<{ Querystring: { q?: string; limit?: string } }>(
    "/api/v1/users", searchLimit, async (request, reply) => {
      const q = request.query.q?.trim().slice(0, 48) ?? "";
      if (q.length < 2) return reply.code(400).send(authError(400, "Type at least two characters to find people."));
      const limit = Math.min(10, Math.max(1, Number(request.query.limit) || 8));
      const pattern = `%${q.replace(/[,%()]/g, " ").trim()}%`;
      const client = authClient();
      const found = await client.from("public_profiles")
        .select("id,username,display_name,avatar_url,status")
        .eq("visibility", "public")
        .or(`username.ilike.${pattern},display_name.ilike.${pattern}`)
        .limit(limit);
      if (found.error) {
        request.log.error({ code: found.error.code, message: found.error.message }, "User autocomplete failed");
        return reply.code(503).send(authError(503, "People search is temporarily unavailable."));
      }
      const items = (found.data ?? []) as Array<Record<string, unknown>>;
      const ids = items.map((item) => String(item.id));
      const stats = ids.length
        ? await client.from("public_profile_stats").select("user_id,followers").in("user_id", ids)
        : { data: [] };
      const followers = new Map<string, number>(
        ((stats.data ?? []) as Array<{ user_id: string; followers: number }>)
          .map((row) => [String(row.user_id), Number(row.followers ?? 0)])
      );
      return {
        query: q,
        items: items.map((item) => ({
          id: item.id, username: item.username, displayName: item.display_name,
          avatarUrl: item.avatar_url ?? null, status: item.status ?? null,
          followers: followers.get(String(item.id)) ?? 0
        }))
      };
    }
  );

  // ----- public profile ----------------------------------------------------
  app.get<{ Params: { username: string } }>(
    "/api/v1/users/:username", readLimit, async (request, reply) => {
      const target = await publicTarget(request, reply);
      if (!target) return;
      const viewer = await viewerId(request);
      if (target.visibility !== "public" && viewer !== target.id) {
        return reply.code(403).send(authError(403, "This profile is private."));
      }
      const client = authClient();
      const [stats, playlists] = await Promise.all([
        client.from("public_profile_stats").select("*").eq("user_id", target.id).maybeSingle(),
        client.from("playlists").select("id,title,description,updated_at")
          .eq("owner_id", target.id).eq("is_public", true)
          .order("updated_at", { ascending: false }).limit(6)
      ]);
      // Top artists honour the history privacy switch: with history hidden the
      // event rows are never read at all.
      const historyVisible = target.show_history !== false;
      const events = historyVisible
        ? await client.from("provider_listening_events")
            .select("artist_name,listened_ms,occurred_at")
            .eq("user_id", target.id)
            .gte("occurred_at", new Date(Date.now() - 90 * 86_400_000).toISOString())
            .order("occurred_at", { ascending: false }).limit(1500)
        : { data: [] };
      const summary = summarizeEvents(((events.data ?? []) as Array<Record<string, unknown>>).map((row) => ({
        artist: String(row.artist_name ?? "Unknown artist"),
        title: "",
        minutes: minutesOf(Number(row.listened_ms ?? 0)),
        occurredAt: String(row.occurred_at ?? ""),
        event: "play", genre: null, trackKey: ""
      })));
      let isFollowing = false;
      let followsViewer = false;
      if (viewer && viewer !== target.id) {
        const [outgoing, incoming] = await Promise.all([
          client.from("user_follows").select("follower_id").eq("follower_id", viewer).eq("followee_id", target.id).maybeSingle(),
          client.from("user_follows").select("follower_id").eq("follower_id", target.id).eq("followee_id", viewer).maybeSingle()
        ]);
        isFollowing = Boolean(outgoing.data);
        followsViewer = Boolean(incoming.data);
      }
      const counts = (stats.data ?? {}) as Record<string, number>;
      return {
        profile: {
          id: target.id,
          username: target.username,
          displayName: target.display_name,
          avatarUrl: target.avatar_url ?? null,
          coverUrl: target.cover_url ?? null,
          accent: target.accent ?? null,
          role: target.role ?? null,
          status: target.status ?? null,
          bio: target.bio ?? null,
          links: linksOr(target.links),
          genres: genresOr(target.favorite_genres),
          joinedAt: target.created_at,
          historyVisible,
          topArtists: historyVisible ? summary.topArtists : [],
          minutes90: historyVisible ? summary.totalMinutes : null,
          publicPlaylists: (playlists.data ?? []) as unknown[],
          counts: {
            favorites: Number(counts.provider_favorites ?? 0) + Number(counts.catalog_favorites ?? 0),
            playlists: Number(counts.playlists ?? 0),
            publicPlaylists: Number(counts.public_playlists ?? 0),
            followers: Number(counts.followers ?? 0),
            following: Number(counts.following ?? 0)
          },
          relationship: { isFollowing, followsViewer, isSelf: viewer === target.id }
        }
      };
    }
  );

  app.get<{ Params: { username: string } }>(
    "/api/v1/users/:username/playlists", readLimit, async (request, reply) => {
      const target = await publicTarget(request, reply);
      if (!target) return;
      const { data, error } = await authClient().from("playlists")
        .select("id,title,description,is_public,updated_at")
        .eq("owner_id", target.id).eq("is_public", true)
        .order("updated_at", { ascending: false }).limit(50);
      if (error) {
        request.log.error({ code: error.code }, "Public playlist listing failed");
        return reply.code(503).send(authError(503, "These playlists are temporarily unavailable."));
      }
      return { username: target.username, items: data ?? [] };
    }
  );

  // ----- follow toggle -----------------------------------------------------
  app.post<{ Params: { username: string } }>(
    "/api/v1/users/:username/follow", socialLimit, async (request, reply) => {
      const auth = await requireUser(request, reply);
      if (!auth) return;
      const target = await publicTarget(request, reply);
      if (!target) return;
      if (target.id === auth.user.id) {
        return reply.code(400).send(authError(400, "You cannot follow your own profile."));
      }
      const { error } = await auth.client.from("user_follows").upsert(
        { follower_id: auth.user.id, followee_id: target.id },
        { onConflict: "follower_id,followee_id", ignoreDuplicates: true }
      );
      if (error) {
        request.log.warn({ code: error.code }, "Follow could not be saved");
        return reply.code(400).send(authError(400,
          error.code === "42P01" ? "Follows are not provisioned yet (migration 010)." : "Could not follow this profile."));
      }
      const { count } = await auth.client.from("user_follows")
        .select("follower_id", { count: "exact", head: true }).eq("followee_id", target.id);
      return reply.code(201).send({ ok: true, following: true, username: target.username, followers: count ?? 0 });
    }
  );

  app.delete<{ Params: { username: string } }>(
    "/api/v1/users/:username/follow", socialLimit, async (request, reply) => {
      const auth = await requireUser(request, reply);
      if (!auth) return;
      const target = await publicTarget(request, reply);
      if (!target) return;
      const { error } = await auth.client.from("user_follows").delete()
        .eq("follower_id", auth.user.id).eq("followee_id", target.id);
      if (error) return reply.code(400).send(authError(400, "Could not undo this follow."));
      const { count } = await auth.client.from("user_follows")
        .select("follower_id", { count: "exact", head: true }).eq("followee_id", target.id);
      return { ok: true, following: false, username: target.username, followers: count ?? 0 };
    }
  );

  // ----- followers / following --------------------------------------------
  for (const direction of ["followers", "following"] as const) {
    app.get<{ Params: { username: string }; Querystring: { offset?: string } }>(
      `/api/v1/users/:username/${direction}`, readLimit, async (request, reply) => {
        const target = await publicTarget(request, reply);
        if (!target) return;
        const ownColumn = direction === "followers" ? "followee_id" : "follower_id";
        const otherColumn = direction === "followers" ? "follower_id" : "followee_id";
        const offset = Math.min(5000, Math.max(0, Number(request.query.offset) || 0));
        const client = authClient();
        const { data, error } = await client.from("user_follows")
          .select(`${otherColumn},created_at`).eq(ownColumn, target.id)
          .order("created_at", { ascending: false }).range(offset, offset + 49);
        if (error) {
          request.log.error({ code: error.code, message: error.message }, "Follow list query failed");
          return reply.code(503).send(authError(503,
            error.code === "42P01"
              ? "Follows are not provisioned yet (migration 010)."
              : "This list is temporarily unavailable."));
        }
        const rows = (data ?? []) as Array<Record<string, string>>;
        const ids = rows.map((row) => row[otherColumn]);
        const profiles = ids.length
          ? await client.from("public_profiles").select("id,username,display_name,avatar_url,visibility").in("id", ids)
          : { data: [] };
        const byId = new Map<string, Record<string, unknown>>(
          ((profiles.data ?? []) as Array<Record<string, unknown>>).map((row) => [String(row.id), row])
        );
        const items = rows.flatMap((row) => {
          const profile = byId.get(row[otherColumn]);
          // Accounts that switched to private drop out of the list instead of
          // rendering a blank row.
          if (!profile || profile.visibility === "private") return [];
          return [{
            id: row[otherColumn], username: profile.username, displayName: profile.display_name,
            avatarUrl: profile.avatar_url ?? null, since: row.created_at
          }];
        });
        return { username: target.username, direction, limit: 50, offset, items, nextOffset: offset + 50 };
      }
    );
  }
}
