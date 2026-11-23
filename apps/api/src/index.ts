import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import type { FastifyRequest } from "fastify";
import { authClient, authError, cleanText, requireUser } from "./auth-helpers.js";
import { createLicensedCatalog } from "./licensed-catalog.js";
import { registerLyricsRoutes } from "./lyrics.js";
import { createCommonsCatalog } from "./commons-catalog.js";
import { searchOfficialReleases } from "./official-releases.js";
import {
  ACCENT_PRESETS, PROFILE_AVATAR_BODY_LIMIT, PROFILE_ROLES, normalizeGenres, normalizeLinks,
  normalizePrivacy, readProfile, registerProfileRoutes
} from "./profile-routes.js";
const app = Fastify({ logger: true, trustProxy: true, bodyLimit: 3_000_000 });
const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? "0.0.0.0";
const licensedCatalog = createLicensedCatalog(process.env);
const commonsCatalog = createCommonsCatalog();

await app.register(cookie);
await app.register(cors, {
  origin: process.env.CORS_ORIGIN?.split(",").map((value) => value.trim()) ?? ["http://localhost:3000"],
  credentials: true
});
// Abuse protection for public and auth endpoints. Limits are conservative for
// legitimate single-user sessions and can be overridden per route via configs.
await app.register(rateLimit, {
  global: false,
  keyGenerator: (request: FastifyRequest) => request.ip,
  max: 300,
  timeWindow: "1 minute",
  cache: 5000,
  errorResponseBuilder: () => ({ statusCode: 429, error: "Too many requests, please slow down." })
});
const otpRateLimit = {
  config: { rateLimit: { keyGenerator: (request: FastifyRequest) => request.ip, max: 10, timeWindow: "1 minute" } }
};
const verifyRateLimit = {
  config: { rateLimit: { keyGenerator: (request: FastifyRequest) => request.ip, max: 15, timeWindow: "1 minute" } }
};
const refreshRateLimit = {
  config: { rateLimit: { keyGenerator: (request: FastifyRequest) => request.ip, max: 60, timeWindow: "1 minute" } }
};
const writeRateLimit = {
  config: { rateLimit: { keyGenerator: (request: FastifyRequest) => request.ip, max: 120, timeWindow: "1 minute" } }
};

function validEmail(value: unknown): value is string {
  return typeof value === "string" && value.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function profileColumnsUnavailable(error: { code?: unknown } | null | undefined): boolean {
  return error?.code === "42703" || error?.code === "PGRST204";
}

// Verifies a provider stream URL with a tiny ranged request. Signed provider
// URLs can expire or point at removed tracks; players must report the truth
// instead of starting a stream that cannot load (never fake playback).
async function probeStream(audioUrl: unknown): Promise<boolean> {
  if (typeof audioUrl !== "string" || !audioUrl.startsWith("https://")) return false;
  try {
    const response = await fetch(audioUrl, {
      method: "GET", headers: { Range: "bytes=0-2047" }, signal: AbortSignal.timeout(6000)
    });
    if (!response.ok) return false;
    const contentType = response.headers.get("content-type") ?? "";
    return contentType.startsWith("audio") || contentType === "";
  } catch {
    return false;
  }
}

app.get("/health", async () => ({
  status: "ok",
  service: "sonora-api",
  timestamp: new Date().toISOString()
}));

app.get("/api/v1", async () => ({
  name: "SONORA API",
  version: "0.2.0",
  status: "auth-enabled",
  endpoints: [
    "/health",
    "/api/v1/auth/register",
    "/api/v1/auth/login",
    "/api/v1/auth/verify",
    "/api/v1/auth/refresh",
    "/api/v1/auth/me",
    "/api/v1/auth/logout",
    "/api/v1/profile",
    "/api/v1/profile/avatar",
    "/api/v1/catalog/tracks",
    "/api/v1/catalog/search",
    "/api/v1/search/music",
    "/api/v1/discovery/search",
    "/api/v1/discovery/resolve",
    "/api/v1/providers/jamendo/tracks",
    "/api/v1/providers/audius/tracks",
    "/api/v1/providers/commons/tracks",
    "/api/v1/recommendations",
    "/api/v1/assistant",
    "/api/v1/assistant/speech",
    "/api/v1/lyrics",
    "/api/v1/import/link",
    "/api/v1/import/file",
    "/api/v1/import/jobs",
    "/api/v1/import/jobs/:id",
    "/api/v1/playlists",
    "/api/v1/playlists/:playlistId",
    "/api/v1/playlists/:playlistId/tracks",
    "/api/v1/playlists/:playlistId/provider-tracks",
    "/api/v1/playlists/:playlistId/provider-tracks/:provider/:providerTrackId",
    "/api/v1/playlists/:playlistId/tracks/:trackId",
    "/api/v1/favorites",
    "/api/v1/favorites/:trackId",
    "/api/v1/history",
    "/api/v1/provider-history",
    "/api/v1/provider-favorites",
    "/api/v1/provider-favorites/:providerTrackId"
  ]
}));

app.post<{ Body: { email?: string; username?: string; displayName?: string } }>(
  "/api/v1/auth/register",
  otpRateLimit,
  async (request, reply) => {
    const { email, username, displayName } = request.body ?? {};
    if (!validEmail(email) || !cleanText(username, 3, 24) ||
        !/^[a-zA-Z0-9_]+$/.test(username) || !cleanText(displayName, 1, 48)) {
      return reply.code(400).send(authError(400, "Enter a valid email, username (3-24 letters, numbers or _), and display name."));
    }

    try {
      const client = authClient();
      const { error } = await client.auth.signInWithOtp({
        email: email.trim().toLowerCase(),
        options: {
          shouldCreateUser: true,
          data: { username: username.trim().toLowerCase(), display_name: displayName.trim() }
        }
      });
      if (error) {
        request.log.warn({ code: error.code, status: error.status }, "Supabase registration OTP request failed");
        return reply.code(error.status && error.status >= 400 ? error.status : 400)
          .send(authError(400, "Could not send a sign-up code. Check the email and try again."));
      }
      return reply.code(202).send({ ok: true, message: "Verification code requested. Check your email." });
    } catch (error) {
      request.log.error({ err: error }, "Registration service unavailable");
      return reply.code(503).send(authError(503, "Authentication service is temporarily unavailable."));
    }
  }
);

app.post<{ Body: { email?: string } }>("/api/v1/auth/login", otpRateLimit, async (request, reply) => {
  const { email } = request.body ?? {};
  if (!validEmail(email)) return reply.code(400).send(authError(400, "Enter a valid email address."));

  try {
    const { error } = await authClient().auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: { shouldCreateUser: false }
    });
    if (error) {
      request.log.warn({ code: error.code, status: error.status }, "Supabase login OTP request failed");
      return reply.code(400).send(authError(400, "Could not send a sign-in code. Check the address and try again."));
    }
    return reply.code(202).send({ ok: true, message: "If the account exists, a verification code has been sent." });
  } catch (error) {
    request.log.error({ err: error }, "Login service unavailable");
    return reply.code(503).send(authError(503, "Authentication service is temporarily unavailable."));
  }
});

app.post<{ Body: { email?: string; token?: string } }>("/api/v1/auth/verify", verifyRateLimit, async (request, reply) => {
  const { email, token } = request.body ?? {};
  if (!validEmail(email) || typeof token !== "string" || !/^\d{8}$/.test(token)) {
    return reply.code(400).send(authError(400, "Enter the email address and eight-digit code."));
  }

  try {
    const client = authClient();
    const { data, error } = await client.auth.verifyOtp({
      email: email.trim().toLowerCase(),
      token,
      type: "email"
    });
    if (error || !data.session || !data.user) {
      return reply.code(400).send(authError(400, "The code is invalid or expired. Request a new one."));
    }

    const profileClient = authClient(data.session.access_token);
    const metadata = data.user.user_metadata ?? {};
    const username = typeof metadata.username === "string" ? metadata.username : null;
    const displayName = typeof metadata.display_name === "string" ? metadata.display_name : username;

    if (username && data.user.email && displayName) {
      const { error: profileError } = await profileClient.from("users").upsert({
        id: data.user.id,
        email: data.user.email,
        username,
        display_name: displayName
      }, { onConflict: "id" });

      if (profileError) {
        request.log.error({ code: profileError.code, message: profileError.message }, "Profile creation failed");
        await client.auth.signOut({ scope: "local" });
        return reply.code(409).send(authError(409, "Account verified, but its profile could not be created. Contact support."));
      }
    }

    reply.setCookie("sonora_refresh", data.session.refresh_token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/api/v1/auth", maxAge: 60 * 60 * 24 * 90 });

    return {
      ok: true,
      user: {
        id: data.user.id,
        email: data.user.email,
        username,
        displayName
      },
      session: {
        access_token: data.session.access_token,
        token_type: data.session.token_type,
        expires_in: data.session.expires_in,
        expires_at: data.session.expires_at
      }
    };
  } catch (error) {
    request.log.error({ err: error }, "OTP verification unavailable");
    return reply.code(503).send(authError(503, "Authentication service is temporarily unavailable."));
  }
});

app.post("/api/v1/auth/refresh", refreshRateLimit, async (request, reply) => {
  const refreshToken = request.cookies.sonora_refresh;
  if (!cleanText(refreshToken, 10, 4096)) {
    return reply.code(401).send(authError(401, "A valid refresh token is required."));
  }

  try {
    const { data, error } = await authClient().auth.refreshSession({ refresh_token: refreshToken });
    if (error || !data.session || !data.user) {
      reply.clearCookie("sonora_refresh", { path: "/api/v1/auth", httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" });
      return reply.code(401).send(authError(401, "Session expired. Please sign in again."));
    }

    // Keep the refresh cookie lifetime consistent with the initial sign-in (90 days).
    reply.setCookie("sonora_refresh", data.session.refresh_token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/api/v1/auth", maxAge: 60 * 60 * 24 * 90 });

    const metadata = data.user.user_metadata ?? {};
    const profileClient = authClient(data.session.access_token);
    const { data: profile, error: profileError } = await profileClient.from("users")
      .select("id,email,username,display_name,avatar_url,created_at")
      .eq("id", data.user.id).maybeSingle();
    if (profileError) request.log.warn({ code: profileError.code }, "Profile lookup during session refresh failed");

    return {
      ok: true,
      user: {
        id: data.user.id,
        email: profile?.email ?? data.user.email ?? "",
        username: profile?.username ?? (typeof metadata.username === "string" ? metadata.username : ""),
        displayName: profile?.display_name ?? (typeof metadata.display_name === "string" ? metadata.display_name : ""),
        avatarUrl: profile?.avatar_url ?? null,
        createdAt: profile?.created_at ?? null
      },
      session: {
        access_token: data.session.access_token,
        token_type: data.session.token_type,
        expires_in: data.session.expires_in,
        expires_at: data.session.expires_at
      }
    };
  } catch (error) {
    request.log.error({ err: error }, "Session refresh unavailable");
    return reply.code(503).send(authError(503, "Authentication service is temporarily unavailable."));
  }
});

app.get("/api/v1/auth/me", async (request, reply) => {
  const authorization = request.headers.authorization;
  const accessToken = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!accessToken) return reply.code(401).send(authError(401, "Authentication required."));

  try {
    const { data, error } = await authClient().auth.getUser(accessToken);
    if (error || !data.user) return reply.code(401).send(authError(401, "Session is invalid or expired."));
    const metadata = data.user.user_metadata ?? {};
    const { data: profile } = await authClient(accessToken).from("users")
      .select("id,email,username,display_name,avatar_url,created_at")
      .eq("id", data.user.id).maybeSingle();
    return {
      user: {
        id: data.user.id,
        email: profile?.email ?? data.user.email ?? "",
        username: profile?.username ?? (typeof metadata.username === "string" ? metadata.username : ""),
        displayName: profile?.display_name ?? (typeof metadata.display_name === "string" ? metadata.display_name : ""),
        avatarUrl: profile?.avatar_url ?? null,
        createdAt: profile?.created_at ?? null
      }
    };
  } catch (error) {
    request.log.error({ err: error }, "Session validation unavailable");
    return reply.code(503).send(authError(503, "Authentication service is temporarily unavailable."));
  }
});

app.get("/api/v1/profile", async (request, reply) => {
  const auth = await requireUser(request, reply);
  if (!auth) return;
  const profile = await readProfile(auth.client, auth.user.id);
  if (!profile.user) return reply.code(404).send(authError(404, "Profile not found."));
  if (profile.partial) request.log.warn("Profile Center columns are not migrated yet (010_profile_center.sql)");
  return profile.partial ? { partial: true, user: profile.user } : { user: profile.user };
});

app.patch<{
  Body: {
    displayName?: string; username?: string; bio?: string | null; accent?: string | null;
    role?: string | null; status?: string | null; links?: unknown; privacy?: unknown;
    favoriteGenres?: unknown;
  }
}>("/api/v1/profile", async (request, reply) => {
  const auth = await requireUser(request, reply);
  if (!auth) return;
  const { displayName, username, bio, accent, role, status, links, privacy, favoriteGenres } = request.body ?? {};
  const update: Record<string, unknown> = {};
  let extendedFieldsRequested = false;
  if (displayName !== undefined) {
    if (!cleanText(displayName, 1, 48)) return reply.code(400).send(authError(400, "Display name must be 1-48 characters."));
    update.display_name = displayName.trim();
  }
  if (username !== undefined) {
    if (!cleanText(username, 3, 24) || !/^[a-zA-Z0-9_]+$/.test(username.trim())) {
      return reply.code(400).send(authError(400, "Username must be 3-24 letters, numbers or underscores."));
    }
    update.username = username.trim().toLowerCase();
  }
  if (bio !== undefined) {
    extendedFieldsRequested = true;
    if (bio === null || (typeof bio === "string" && bio.trim() === "")) update.bio = null;
    else if (typeof bio !== "string" || bio.trim().length > 280) {
      return reply.code(400).send(authError(400, "About me is 280 characters or fewer."));
    } else update.bio = bio.trim();
  }
  if (status !== undefined) {
    extendedFieldsRequested = true;
    if (status === null || (typeof status === "string" && status.trim() === "")) update.status = null;
    else if (typeof status !== "string" || status.trim().length > 60) {
      return reply.code(400).send(authError(400, "Status is 60 characters or fewer."));
    } else update.status = status.trim();
  }
  if (accent !== undefined) {
    extendedFieldsRequested = true;
    if (accent === null || accent === "") update.accent = null;
    else if (typeof accent !== "string" || !ACCENT_PRESETS.includes(accent as typeof ACCENT_PRESETS[number])) {
      return reply.code(400).send(authError(400, `Cover style must be one of: ${ACCENT_PRESETS.join(", ")}.`));
    } else update.accent = accent;
  }
  if (role !== undefined) {
    extendedFieldsRequested = true;
    if (role === null || role === "") update.role = null;
    else if (typeof role !== "string" || !PROFILE_ROLES.includes(role as typeof PROFILE_ROLES[number])) {
      return reply.code(400).send(authError(400, `Role must be one of: ${PROFILE_ROLES.join(", ")}.`));
    } else update.role = role;
  }
  if (links !== undefined) {
    extendedFieldsRequested = true;
    const result = normalizeLinks(links);
    if ("error" in result) return reply.code(400).send(authError(400, result.error));
    update.links = result.items;
  }
  if (privacy !== undefined) {
    extendedFieldsRequested = true;
    const result = normalizePrivacy(privacy);
    if ("error" in result) return reply.code(400).send(authError(400, result.error));
    update.privacy = result.privacy;
  }
  if (favoriteGenres !== undefined) {
    extendedFieldsRequested = true;
    const result = normalizeGenres(favoriteGenres);
    if ("error" in result) return reply.code(400).send(authError(400, result.error));
    update.favorite_genres = result.genres;
  }
  if (!Object.keys(update).length) return reply.code(400).send(authError(400, "No profile changes were provided."));
  update.updated_at = new Date().toISOString();
  const { data, error } = await auth.client.from("users").update(update)
    .eq("id", auth.user.id)
    .select("id,email,username,display_name,avatar_url,created_at").single();
  if (error || !data) {
    if (error?.code === "23505") return reply.code(409).send(authError(409, "That username is already taken."));
    if (extendedFieldsRequested && profileColumnsUnavailable(error)) {
      return reply.code(503).send(authError(503, "Profile Center fields need migration 010 before they can be saved."));
    }
    request.log.error({ code: error?.code }, "Profile update failed");
    return reply.code(400).send(authError(400, "Could not update this profile."));
  }
  const { error: metadataError } = await auth.client.auth.updateUser({
    data: { username: data.username, display_name: data.display_name }
  });
  if (metadataError) request.log.warn({ code: metadataError.code }, "Auth profile metadata sync failed");
  const profile = await readProfile(auth.client, auth.user.id);
  if (!profile.user) return reply.code(404).send(authError(404, "Profile not found after update."));
  return profile.partial ? { partial: true, user: profile.user } : { user: profile.user };
});

app.post<{ Body: { contentType?: string; base64?: string } }>(
  "/api/v1/profile/avatar", { bodyLimit: PROFILE_AVATAR_BODY_LIMIT }, async (request, reply) => {
  const auth = await requireUser(request, reply);
  if (!auth) return;
  const { contentType, base64 } = request.body ?? {};
  const extensions: Record<string, string> = {
    "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"
  };
  if (!contentType || !extensions[contentType] || typeof base64 !== "string" ||
      base64.length < 16 || base64.length > 2_800_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    return reply.code(400).send(authError(400, "Choose a JPG, PNG or WebP image up to 2 MB."));
  }
  const image = Buffer.from(base64, "base64");
  if (!image.length || image.length > 2 * 1024 * 1024) {
    return reply.code(400).send(authError(400, "The image must be 2 MB or smaller."));
  }
  const path = `${auth.user.id}/avatar.${extensions[contentType]}`;
  const { error: uploadError } = await auth.client.storage.from("sonora-avatars").upload(path, image, {
    contentType, upsert: true, cacheControl: "3600"
  });
  if (uploadError) {
    request.log.error({ message: uploadError.message }, "Avatar upload failed");
    return reply.code(400).send(authError(400, "Could not upload the avatar. Try another image."));
  }
  const { data: publicData } = auth.client.storage.from("sonora-avatars").getPublicUrl(path);
  const avatarUrl = `${publicData.publicUrl}?v=${Date.now()}`;
  const { data, error } = await auth.client.from("users").update({
    avatar_url: avatarUrl, updated_at: new Date().toISOString()
  }).eq("id", auth.user.id)
    .select("id,email,username,display_name,avatar_url,created_at").single();
  if (error || !data) {
    request.log.error({ code: error?.code }, "Avatar profile update failed");
    return reply.code(400).send(authError(400, "Avatar uploaded but profile could not be updated."));
  }
  return { user: {
    id: data.id, email: data.email, username: data.username,
    displayName: data.display_name, avatarUrl: data.avatar_url, createdAt: data.created_at
  }};
  }
);

app.post("/api/v1/auth/logout", async (request, reply) => {
  const authorization = request.headers.authorization;
  const accessToken = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!accessToken) return reply.code(401).send(authError(401, "Authentication required."));

  const refreshToken = request.cookies.sonora_refresh;
  try {
    if (cleanText(refreshToken, 10, 4096)) {
      const client = authClient(accessToken);
      const { error: refreshError } = await client.auth.refreshSession({ refresh_token: refreshToken });
      if (!refreshError) {
        const { error } = await client.auth.signOut({ scope: "local" });
        if (error) request.log.warn({ code: error.code }, "Supabase sign-out returned an error");
      }
    }
    reply.clearCookie("sonora_refresh", { path: "/api/v1/auth", httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" });
    return { ok: true };
  } catch (error) {
    request.log.error({ err: error }, "Logout unavailable");
    reply.clearCookie("sonora_refresh", { path: "/api/v1/auth", httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" });
    return reply.code(503).send(authError(503, "Authentication service is temporarily unavailable."));
  }
});


// Public catalog: only tracks explicitly cleared for playback are marked licensed.
// Unverified provider references are metadata, not playable URLs.
app.get<{ Querystring: { q?: string; limit?: string; offset?: string } }>("/api/v1/catalog/tracks", async (request, reply) => {
  const q = request.query.q?.trim().slice(0, 120) ?? "";
  const limit = Math.min(50, Math.max(1, Number(request.query.limit) || 20));
  const offset = Math.max(0, Number(request.query.offset) || 0);
  try {
    let query = authClient().from("tracks")
      .select("id,title,duration_ms,artwork_url,playback_provider,playback_reference,rights_status,artist:artists(name),album:albums(title)", { count: "exact" })
      .order("created_at", { ascending: false }).range(offset, offset + limit - 1);
    if (q) query = query.ilike("title", `%${q.replace(/[,%()]/g, " ").trim()}%`);
    const { data, error, count } = await query;
    if (error) {
      request.log.error({ code: error.code }, "Catalog query failed");
      return reply.code(503).send(authError(503, "The music catalog is temporarily unavailable."));
    }
    return { items: data ?? [], total: count ?? 0, limit, offset };
  } catch (error) {
    request.log.error({ err: error }, "Catalog unavailable");
    return reply.code(503).send(authError(503, "The music catalog is temporarily unavailable."));
  }
});

app.get<{ Querystring: { q?: string; limit?: string } }>("/api/v1/catalog/search", async (request, reply) => {
  const q = request.query.q?.trim().slice(0, 120) ?? "";
  if (q.length < 2) return reply.code(400).send(authError(400, "Search query must contain at least two characters."));
  const pattern = `%${q.replace(/[,%()]/g, " ").trim()}%`;
  const limit = Math.min(20, Math.max(1, Number(request.query.limit) || 10));
  try {
    const client = authClient();
    const [tracks, artists, albums] = await Promise.all([
      client.from("tracks").select("id,title,duration_ms,artwork_url,playback_provider,playback_reference,rights_status,artist:artists(name),album:albums(title)").ilike("title", pattern).limit(limit),
      client.from("artists").select("id,name").ilike("name", pattern).limit(limit),
      client.from("albums").select("id,title,artwork_url,artist:artists(name)").ilike("title", pattern).limit(limit)
    ]);
    const failed = [tracks, artists, albums].find((result) => result.error);
    if (failed?.error) {
      request.log.error({ code: failed.error.code }, "Catalog search failed");
      return reply.code(503).send(authError(503, "Search is temporarily unavailable."));
    }
    return { query: q, tracks: tracks.data ?? [], artists: artists.data ?? [], albums: albums.data ?? [] };
  } catch (error) {
    request.log.error({ err: error }, "Catalog search unavailable");
    return reply.code(503).send(authError(503, "Search is temporarily unavailable."));
  }
});

app.get("/api/v1/playlists", async (request, reply) => {
  const auth = await requireUser(request, reply);
  if (!auth) return;
  const { data, error } = await auth.client.from("playlists")
    .select("id,title,description,is_public,created_at,updated_at")
    .eq("owner_id", auth.user.id).order("updated_at", { ascending: false });
  if (error) {
    request.log.error({ code: error.code }, "Playlist listing failed");
    return reply.code(503).send(authError(503, "Playlists are temporarily unavailable."));
  }
  return { items: data ?? [] };
});

app.post<{ Body: { title?: string; description?: string; isPublic?: boolean } }>("/api/v1/playlists", async (request, reply) => {
  const auth = await requireUser(request, reply);
  if (!auth) return;
  const { title, description, isPublic } = request.body ?? {};
  if (!cleanText(title, 1, 80) || (description !== undefined && (typeof description !== "string" || description.length > 500)) || (isPublic !== undefined && typeof isPublic !== "boolean")) {
    return reply.code(400).send(authError(400, "Enter a playlist title (1-80 characters), optional description (up to 500), and valid visibility."));
  }
  const { data, error } = await auth.client.from("playlists").insert({
    owner_id: auth.user.id, title: title.trim(), description: description?.trim() || null, is_public: isPublic ?? false
  }).select("id,title,description,is_public,created_at,updated_at").single();
  if (error) {
    request.log.error({ code: error.code }, "Playlist creation failed");
    return reply.code(400).send(authError(400, "Could not create this playlist."));
  }
  return reply.code(201).send({ playlist: data });
});

app.get<{ Params: { playlistId: string } }>("/api/v1/playlists/:playlistId", async (request, reply) => {
  const auth = await requireUser(request, reply);
  if (!auth) return;
  const { data, error } = await auth.client.from("playlists")
    .select("id,title,description,is_public,created_at,updated_at,playlist_tracks(position,added_at,track:tracks(id,title,duration_ms,artwork_url,playback_provider,playback_reference,rights_status,artist:artists(name),album:albums(title))),provider_playlist_tracks(provider,provider_track_id,title,artist_name,album_name,duration_seconds,artwork_url,license_url,source_url,position,added_at)")
    .eq("id", request.params.playlistId).eq("owner_id", auth.user.id).maybeSingle();
  if (error) return reply.code(503).send(authError(503, "Playlist could not be loaded."));
  if (!data) return reply.code(404).send(authError(404, "Playlist not found."));
  return { playlist: data };
});

app.patch<{ Params: { playlistId: string }; Body: { title?: string; description?: string | null; isPublic?: boolean } }>("/api/v1/playlists/:playlistId", async (request, reply) => {
  const auth = await requireUser(request, reply);
  if (!auth) return;
  const { title, description, isPublic } = request.body ?? {};
  const update: Record<string, unknown> = {};
  if (title !== undefined) {
    if (!cleanText(title, 1, 80)) return reply.code(400).send(authError(400, "Playlist title must be 1-80 characters."));
    update.title = title.trim();
  }
  if (description !== undefined) {
    if (description !== null && (typeof description !== "string" || description.length > 500)) return reply.code(400).send(authError(400, "Description must be up to 500 characters."));
    update.description = typeof description === "string" ? description.trim() || null : null;
  }
  if (isPublic !== undefined) {
    if (typeof isPublic !== "boolean") return reply.code(400).send(authError(400, "Visibility must be true or false."));
    update.is_public = isPublic;
  }
  if (!Object.keys(update).length) return reply.code(400).send(authError(400, "No playlist changes were supplied."));
  update.updated_at = new Date().toISOString();
  const { data, error } = await auth.client.from("playlists").update(update)
    .eq("id", request.params.playlistId).eq("owner_id", auth.user.id)
    .select("id,title,description,is_public,created_at,updated_at").maybeSingle();
  if (error) return reply.code(400).send(authError(400, "Could not update this playlist."));
  if (!data) return reply.code(404).send(authError(404, "Playlist not found."));
  return { playlist: data };
});

app.delete<{ Params: { playlistId: string } }>("/api/v1/playlists/:playlistId", async (request, reply) => {
  const auth = await requireUser(request, reply);
  if (!auth) return;
  const { data, error } = await auth.client.from("playlists").delete()
    .eq("id", request.params.playlistId).eq("owner_id", auth.user.id).select("id").maybeSingle();
  if (error) return reply.code(400).send(authError(400, "Could not delete this playlist."));
  if (!data) return reply.code(404).send(authError(404, "Playlist not found."));
  return { ok: true };
});

app.post<{ Params: { playlistId: string }; Body: { trackId?: string } }>("/api/v1/playlists/:playlistId/tracks", async (request, reply) => {
  const auth = await requireUser(request, reply);
  if (!auth) return;
  const { trackId } = request.body ?? {};
  if (!cleanText(trackId, 36, 36)) return reply.code(400).send(authError(400, "A valid track ID is required."));
  const { data: playlist, error: playlistError } = await auth.client.from("playlists")
    .select("id").eq("id", request.params.playlistId).eq("owner_id", auth.user.id).maybeSingle();
  if (playlistError || !playlist) return reply.code(404).send(authError(404, "Playlist not found."));
  const { data: last } = await auth.client.from("playlist_tracks").select("position")
    .eq("playlist_id", playlist.id).order("position", { ascending: false }).limit(1).maybeSingle();
  const { error } = await auth.client.from("playlist_tracks").insert({
    playlist_id: playlist.id, track_id: trackId, position: (last?.position ?? -1) + 1
  });
  if (error) {
    request.log.warn({ code: error.code }, "Track could not be added to playlist");
    return reply.code(error.code === "23505" ? 409 : 400).send(authError(error.code === "23505" ? 409 : 400, "Track could not be added. It may already be in this playlist."));
  }
  return reply.code(201).send({ ok: true });
});

app.post<{ Params: { playlistId: string }; Body: { provider?: string; providerTrackId?: string } }>("/api/v1/playlists/:playlistId/provider-tracks", async (request, reply) => {
  const auth = await requireUser(request, reply);
  if (!auth) return;
  const { provider, providerTrackId } = request.body ?? {};
  if ((provider !== "jamendo" && provider !== "audius") || typeof providerTrackId !== "string" ||
      (provider === "jamendo" ? !/^[0-9]{1,24}$/.test(providerTrackId) : !/^[a-zA-Z0-9_-]{1,64}$/.test(providerTrackId))) {
    return reply.code(400).send(authError(400, "A valid supported provider and track ID are required."));
  }
  const { data: playlist } = await auth.client.from("playlists").select("id")
    .eq("id", request.params.playlistId).eq("owner_id", auth.user.id).maybeSingle();
  if (!playlist) return reply.code(404).send(authError(404, "Playlist not found."));
  if (provider === "audius") {
    try {
      const response = await fetch(`https://api.audius.co/v1/tracks/${encodeURIComponent(providerTrackId)}?app_name=SONORA`, {
        headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10000)
      });
      if (!response.ok) return reply.code(502).send(authError(502, "Audius could not verify this track."));
      const payload = await response.json() as { data?: Array<{
        id: string; title: string; duration?: number; permalink?: string; is_streamable?: boolean;
        is_stream_gated?: boolean; license?: string; artwork?: Record<string, string> | null;
        user?: { name?: string; handle?: string }; album?: { playlist_name?: string };
      }> | { id: string; title: string; duration?: number; permalink?: string; is_streamable?: boolean;
        is_stream_gated?: boolean; license?: string; artwork?: Record<string, string> | null;
        user?: { name?: string; handle?: string }; album?: { playlist_name?: string } } };
      const track = Array.isArray(payload.data) ? payload.data[0] : payload.data;
      if (!track || track.id !== providerTrackId || !track.title ||
          track.is_streamable !== true || track.is_stream_gated === true) {
        return reply.code(403).send(authError(403, "This Audius track is not available for playback through the public API."));
      }
      const { data: last } = await auth.client.from("provider_playlist_tracks").select("position")
        .eq("playlist_id", playlist.id).order("position", { ascending: false }).limit(1).maybeSingle();
      const { error } = await auth.client.from("provider_playlist_tracks").insert({
        playlist_id: playlist.id, provider: "audius", provider_track_id: track.id,
        title: track.title, artist_name: track.user?.name ?? track.user?.handle ?? "Audius creator",
        album_name: track.album?.playlist_name ?? null, duration_seconds: track.duration ?? null,
        artwork_url: track.artwork?.["480x480"] ?? track.artwork?.["150x150"] ?? null,
        license_url: typeof track.license === "string" && track.license.startsWith("http") ? track.license : "https://audius.co/terms",
        source_url: audiusPublicPage(track.permalink), position: (last?.position ?? -1) + 1
      });
      if (error) return reply.code(error.code === "23505" ? 409 : 400).send(authError(error.code === "23505" ? 409 : 400, "Track could not be added. It may already be in this playlist."));
      return reply.code(201).send({ ok: true, provider: "audius", providerTrackId: track.id });
    } catch (error) {
      request.log.error({ err: error }, "Audius playlist track verification failed");
      return reply.code(502).send(authError(502, "Audius could not verify this track right now."));
    }
  }
  const jamendo = jamendoConfig();
  if (!jamendo) {
    return reply.code(503).send(authError(503, "Jamendo catalog is not configured."));
  }
  const clientId = jamendo.clientId;
  try {
    const params = new URLSearchParams({
      client_id: clientId, format: "json", id: providerTrackId,
      include: "licenses musicinfo", type: "single albumtrack", audioformat: "mp32"
    });
    const response = await fetch(`https://api.jamendo.com/v3.0/tracks/?${params.toString()}`, {
      headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) return reply.code(502).send(authError(502, "Jamendo could not verify this track."));
    const payload = await response.json() as { results?: Array<{
      id: string; name: string; duration: number; artist_name: string;
      album_name?: string; image?: string; album_image?: string; audio?: string;
      license_ccurl?: string; shareurl?: string;
    }> };
    const track = payload.results?.[0];
    if (!track || track.id !== providerTrackId || !track.audio) {
      return reply.code(404).send(authError(404, "This track is not available for playback."));
    }
    const licenseUrl = track.license_ccurl ?? "";
    const normalized = licenseUrl.toLowerCase()
      .replace("http://creativecommons.org/", "")
      .replace("https://creativecommons.org/", "")
      .replace("https://www.creativecommons.org/", "");
    const slug = normalized.startsWith("licenses/") ? normalized.split("/")[1] ?? "" : "";
    const isCcZero = normalized.startsWith("publicdomain/zero/");
    const isKnownCc = isCcZero || ["by", "by-sa", "by-nd", "by-nc", "by-nc-sa", "by-nc-nd"].includes(slug);
    const licenseAllowed = isKnownCc && (process.env.JAMENDO_USE_MODE === "noncommercial" || !slug.includes("-nc"));
    if (!licenseAllowed) return reply.code(403).send(authError(403, "This track's license is not enabled for this catalog."));
    const { data: last } = await auth.client.from("provider_playlist_tracks").select("position")
      .eq("playlist_id", playlist.id).order("position", { ascending: false }).limit(1).maybeSingle();
    const { error } = await auth.client.from("provider_playlist_tracks").insert({
      playlist_id: playlist.id, provider: "jamendo", provider_track_id: track.id,
      title: track.name, artist_name: track.artist_name, album_name: track.album_name ?? null,
      duration_seconds: track.duration, artwork_url: track.album_image ?? track.image ?? null,
      license_url: licenseUrl, source_url: track.shareurl ?? `https://www.jamendo.com/track/${track.id}`,
      position: (last?.position ?? -1) + 1
    });
    if (error) {
      request.log.warn({ code: error.code }, "Provider track could not be added to playlist");
      return reply.code(error.code === "23505" ? 409 : 400).send(authError(error.code === "23505" ? 409 : 400, "Track could not be added. It may already be in this playlist."));
    }
    return reply.code(201).send({ ok: true, provider: "jamendo", providerTrackId: track.id });
  } catch (error) {
    request.log.error({ err: error }, "Provider playlist track verification failed");
    return reply.code(502).send(authError(502, "Jamendo could not verify this track right now."));
  }
});

app.delete<{ Params: { playlistId: string; provider: string; providerTrackId: string } }>("/api/v1/playlists/:playlistId/provider-tracks/:provider/:providerTrackId", async (request, reply) => {
  const auth = await requireUser(request, reply);
  if (!auth) return;
  const { data: playlist } = await auth.client.from("playlists").select("id")
    .eq("id", request.params.playlistId).eq("owner_id", auth.user.id).maybeSingle();
  if (!playlist) return reply.code(404).send(authError(404, "Playlist not found."));
  const { data, error } = await auth.client.from("provider_playlist_tracks").delete()
    .eq("playlist_id", playlist.id).eq("provider", request.params.provider)
    .eq("provider_track_id", request.params.providerTrackId).select("provider_track_id").maybeSingle();
  if (error) return reply.code(400).send(authError(400, "Could not remove this provider track."));
  if (!data) return reply.code(404).send(authError(404, "Track not found in this playlist."));
  return { ok: true };
});

app.delete<{ Params: { playlistId: string; trackId: string } }>("/api/v1/playlists/:playlistId/tracks/:trackId", async (request, reply) => {
  const auth = await requireUser(request, reply);
  if (!auth) return;
  const { data: playlist } = await auth.client.from("playlists").select("id")
    .eq("id", request.params.playlistId).eq("owner_id", auth.user.id).maybeSingle();
  if (!playlist) return reply.code(404).send(authError(404, "Playlist not found."));
  const { data, error } = await auth.client.from("playlist_tracks").delete()
    .eq("playlist_id", playlist.id).eq("track_id", request.params.trackId).select("track_id").maybeSingle();
  if (error) return reply.code(400).send(authError(400, "Could not remove this track."));
  if (!data) return reply.code(404).send(authError(404, "Track not found in this playlist."));
  return { ok: true };
});



// Favorites: one row per user/track, protected by RLS and a composite primary key.
app.get("/api/v1/favorites", async (request, reply) => {
  const auth = await requireUser(request, reply);
  if (!auth) return;
  const { data, error } = await auth.client.from("user_favorites")
    .select("created_at,track:tracks(id,title,duration_ms,artwork_url,playback_provider,playback_reference,rights_status,artist:artists(name),album:albums(title))")
    .eq("user_id", auth.user.id).order("created_at", { ascending: false });
  if (error) {
    request.log.error({ code: error.code }, "Favorites listing failed");
    return reply.code(503).send(authError(503, "Favorites are temporarily unavailable."));
  }
  return { items: data ?? [] };
});

app.post<{ Body: { trackId?: string } }>("/api/v1/favorites", async (request, reply) => {
  const auth = await requireUser(request, reply);
  if (!auth) return;
  const { trackId } = request.body ?? {};
  if (typeof trackId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trackId)) {
    return reply.code(400).send(authError(400, "A valid track ID is required."));
  }
  const { error } = await auth.client.from("user_favorites")
    .upsert({ user_id: auth.user.id, track_id: trackId }, { onConflict: "user_id,track_id", ignoreDuplicates: true });
  if (error) {
    request.log.warn({ code: error.code }, "Favorite could not be saved");
    return reply.code(error.code === "23503" ? 404 : 400).send(authError(error.code === "23503" ? 404 : 400, "Track could not be added to favorites."));
  }
  return reply.code(201).send({ ok: true });
});

app.delete<{ Params: { trackId: string } }>("/api/v1/favorites/:trackId", async (request, reply) => {
  const auth = await requireUser(request, reply);
  if (!auth) return;
  const { data, error } = await auth.client.from("user_favorites").delete()
    .eq("user_id", auth.user.id).eq("track_id", request.params.trackId).select("track_id").maybeSingle();
  if (error) return reply.code(400).send(authError(400, "Favorite could not be removed."));
  if (!data) return reply.code(404).send(authError(404, "Favorite not found."));
  return { ok: true };
});

// Listening history stores real user actions; it never fabricates playback progress.
app.get<{ Querystring: { limit?: string } }>("/api/v1/history", async (request, reply) => {
  const auth = await requireUser(request, reply);
  if (!auth) return;
  const limit = Math.min(100, Math.max(1, Number(request.query.limit) || 30));
  const { data, error } = await auth.client.from("listening_events")
    .select("id,event_type,listened_ms,occurred_at,track:tracks(id,title,duration_ms,artwork_url,artist:artists(name),album:albums(title))")
    .eq("user_id", auth.user.id).order("occurred_at", { ascending: false }).limit(limit);
  if (error) {
    request.log.error({ code: error.code }, "Listening history query failed");
    return reply.code(503).send(authError(503, "Listening history is temporarily unavailable."));
  }
  return { items: data ?? [] };
});

app.post<{ Body: { trackId?: string; eventType?: string; listenedMs?: number } }>("/api/v1/history", async (request, reply) => {
  const auth = await requireUser(request, reply);
  if (!auth) return;
  const { trackId, eventType, listenedMs } = request.body ?? {};
  const validTrackId = typeof trackId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trackId);
  if (!validTrackId || !["play", "complete", "skip"].includes(eventType ?? "") ||
      (listenedMs !== undefined && (!Number.isInteger(listenedMs) || listenedMs < 0 || listenedMs > 86_400_000))) {
    return reply.code(400).send(authError(400, "Provide a valid track ID, play/complete/skip event, and non-negative listening duration."));
  }
  const { data, error } = await auth.client.from("listening_events").insert({
    user_id: auth.user.id, track_id: trackId, event_type: eventType, listened_ms: listenedMs ?? 0
  }).select("id,event_type,listened_ms,occurred_at").single();
  if (error) {
    request.log.warn({ code: error.code }, "Listening event could not be stored");
    return reply.code(error.code === "23503" ? 404 : 400).send(authError(error.code === "23503" ? 404 : 400, "Listening event could not be saved."));
  }
  return reply.code(201).send({ event: data });
});

// Jamendo listening history is separate from first-party UUID track history.
app.get<{ Querystring: { limit?: string } }>("/api/v1/provider-history", async (request, reply) => {
  const auth = await requireUser(request, reply);
  if (!auth) return;
  const limit = Math.min(100, Math.max(1, Number(request.query.limit) || 30));
  const { data, error } = await auth.client.from("provider_listening_events")
    .select("id,provider,provider_track_id,title,artist_name,album_name,duration_seconds,artwork_url,license_url,source_url,event_type,listened_ms,occurred_at")
    .eq("user_id", auth.user.id).eq("provider", "jamendo")
    .order("occurred_at", { ascending: false }).limit(limit);
  if (error) {
    request.log.error({ code: error.code }, "Provider listening history query failed");
    return reply.code(503).send(authError(503, "Listening history is temporarily unavailable."));
  }
  return { items: data ?? [] };
});

app.post<{ Body: {
  providerTrackId?: string; title?: string; artistName?: string; albumName?: string | null;
  durationSeconds?: number; artworkUrl?: string | null; licenseUrl?: string; sourceUrl?: string;
  eventType?: "play" | "complete" | "skip"; listenedMs?: number; clientEventId?: string;
} }>("/api/v1/provider-history", async (request, reply) => {
  const auth = await requireUser(request, reply);
  if (!auth) return;
  const body = request.body ?? {};
  const providerTrackId = body.providerTrackId;
  const title = body.title;
  const artistName = body.artistName;
  const albumName = body.albumName;
  const durationSeconds = body.durationSeconds;
  const artworkUrl = body.artworkUrl;
  const licenseUrl = body.licenseUrl;
  const sourceUrl = body.sourceUrl;
  const eventType = body.eventType;
  const listenedMs = body.listenedMs;
  if (typeof providerTrackId !== "string" || !/^[0-9]{1,24}$/.test(providerTrackId) ||
      typeof title !== "string" || title.trim().length < 1 || title.length > 300 ||
      typeof artistName !== "string" || artistName.trim().length < 1 || artistName.length > 200 ||
      (albumName !== null && albumName !== undefined && (typeof albumName !== "string" || albumName.length > 300)) ||
      typeof durationSeconds !== "number" || !Number.isInteger(durationSeconds) || durationSeconds < 1 ||
      (artworkUrl !== null && artworkUrl !== undefined &&
        (typeof artworkUrl !== "string" || artworkUrl.length > 2048 || !artworkUrl.startsWith("https://"))) ||
      typeof licenseUrl !== "string" || licenseUrl.length > 2048 || !(licenseUrl.startsWith("https://creativecommons.org/") || licenseUrl.startsWith("http://creativecommons.org/")) ||
      typeof sourceUrl !== "string" || sourceUrl.length > 2048 || !sourceUrl.startsWith("https://www.jamendo.com/") ||
      !["play", "complete", "skip"].includes(eventType ?? "") ||
      (listenedMs !== undefined && (typeof listenedMs !== "number" || !Number.isInteger(listenedMs) || listenedMs < 0 || listenedMs > 86400000)) ||
      (body.clientEventId !== undefined && !(typeof body.clientEventId === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(body.clientEventId)))) {
    return reply.code(400).send(authError(400, "Invalid provider track metadata or listening event."));
  }
  // Offline replay safety: clients may attach a stable idempotency key so a
  // queued-but-already-delivered event is silently deduplicated, not double counted.
  const clientEventId = body.clientEventId;
  if (typeof clientEventId === "string") {
    const { data: existing } = await auth.client.from("provider_listening_events")
      .select("id").eq("user_id", auth.user.id).eq("provider", "jamendo")
      .eq("client_event_id", clientEventId).limit(1).maybeSingle();
    if (existing) return { ok: true, deduplicated: true };
  }
  const { data, error } = await auth.client.from("provider_listening_events").insert({
    user_id: auth.user.id, provider: "jamendo", provider_track_id: providerTrackId,
    title: title.trim(), artist_name: artistName.trim(), album_name: albumName?.trim() || null,
    duration_seconds: durationSeconds, artwork_url: artworkUrl ?? null,
    license_url: licenseUrl.replace(/^http:/, "https:"), source_url: sourceUrl, event_type: eventType,
    listened_ms: listenedMs ?? 0, client_event_id: clientEventId ?? null
  }).select("id,event_type,listened_ms,occurred_at").single();
  if (error && error.code !== "23505") {
    request.log.warn({ code: error.code }, "Provider listening event could not be stored");
    return reply.code(400).send(authError(400, "Listening event could not be saved."));
  }
  if (error) return { ok: true, deduplicated: true };
  return reply.code(201).send({ event: data });
});

// Jamendo favorites keep the provider's original ID and license metadata.
// They are separate from first-party catalog tracks because provider IDs are not UUIDs.
app.get("/api/v1/provider-favorites", async (request, reply) => {
  const auth = await requireUser(request, reply);
  if (!auth) return;
  const { data, error } = await auth.client.from("user_provider_favorites")
    .select("provider,provider_track_id,title,artist_name,album_name,duration_seconds,artwork_url,license_url,source_url,created_at")
    .eq("user_id", auth.user.id).eq("provider", "jamendo")
    .order("created_at", { ascending: false });
  if (error) {
    request.log.error({ code: error.code }, "Provider favorites listing failed");
    return reply.code(503).send(authError(503, "Favorites are temporarily unavailable."));
  }
  return { items: data ?? [] };
});

app.post<{ Body: { providerTrackId?: string } }>("/api/v1/provider-favorites", async (request, reply) => {
  const auth = await requireUser(request, reply);
  if (!auth) return;
  const { providerTrackId } = request.body ?? {};
  if (typeof providerTrackId !== "string" || !/^[0-9]{1,24}$/.test(providerTrackId)) {
    return reply.code(400).send(authError(400, "A valid Jamendo track ID is required."));
  }
  const jamendo = jamendoConfig();
  if (!jamendo) {
    return reply.code(503).send(authError(503, "Jamendo catalog is not configured."));
  }
  const clientId = jamendo.clientId;
  try {
    const params = new URLSearchParams({
      client_id: clientId, format: "json", id: providerTrackId,
      include: "licenses musicinfo", type: "single albumtrack", audioformat: "mp32"
    });
    const response = await fetch(`https://api.jamendo.com/v3.0/tracks/?${params.toString()}`, {
      headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) return reply.code(502).send(authError(502, "Jamendo could not verify this track."));
    const payload = await response.json() as { results?: Array<{
      id: string; name: string; duration: number; artist_name: string;
      album_name?: string; image?: string; album_image?: string; audio?: string;
      license_ccurl?: string; shareurl?: string;
    }> };
    const track = payload.results?.[0];
    if (!track || track.id !== providerTrackId || !track.audio) {
      return reply.code(404).send(authError(404, "This track is not available from Jamendo."));
    }
    const licenseUrl = track.license_ccurl ?? "";
    const normalized = licenseUrl.toLowerCase()
      .replace("http://creativecommons.org/", "")
      .replace("https://creativecommons.org/", "")
      .replace("https://www.creativecommons.org/", "");
    const slug = normalized.startsWith("licenses/") ? normalized.split("/")[1] ?? "" : "";
    const allowed = normalized.startsWith("publicdomain/zero/") ||
      ["by", "by-sa", "by-nd", "by-nc", "by-nc-sa", "by-nc-nd"].includes(slug);
    if (!allowed) return reply.code(403).send(authError(403, "This track has no supported Creative Commons license for this catalog."));
    const { error } = await auth.client.from("user_provider_favorites").upsert({
      user_id: auth.user.id, provider: "jamendo", provider_track_id: track.id,
      title: track.name, artist_name: track.artist_name,
      album_name: track.album_name ?? null, duration_seconds: track.duration,
      artwork_url: track.album_image ?? track.image ?? null, license_url: licenseUrl,
      source_url: track.shareurl ?? `https://www.jamendo.com/track/${track.id}`
    }, { onConflict: "user_id,provider,provider_track_id", ignoreDuplicates: true });
    if (error) {
      request.log.warn({ code: error.code }, "Provider favorite could not be saved");
      return reply.code(400).send(authError(400, "Could not save this track."));
    }
    return reply.code(201).send({ ok: true, providerTrackId: track.id });
  } catch (error) {
    request.log.error({ err: error }, "Provider favorite verification failed");
    return reply.code(502).send(authError(502, "Jamendo could not verify this track right now."));
  }
});

app.delete<{ Params: { providerTrackId: string } }>("/api/v1/provider-favorites/:providerTrackId", async (request, reply) => {
  const auth = await requireUser(request, reply);
  if (!auth) return;
  const { data, error } = await auth.client.from("user_provider_favorites").delete()
    .eq("user_id", auth.user.id).eq("provider", "jamendo")
    .eq("provider_track_id", request.params.providerTrackId).select("provider_track_id").maybeSingle();
  if (error) return reply.code(400).send(authError(400, "Favorite could not be removed."));
  if (!data) return reply.code(404).send(authError(404, "Favorite not found."));
  return { ok: true };
});

// Jamendo API access is configured for non-commercial use. Known Creative Commons
// licenses are accepted; unknown licenses are rejected. Attribution and license links
// are returned with every catalog item.
app.get<{ Querystring: { q?: string; id?: string; limit?: string; page?: string } }>("/api/v1/providers/jamendo/tracks", async (request, reply) => {
  const clientId = process.env.JAMENDO_CLIENT_ID;
  const nonCommercialMode = process.env.JAMENDO_USE_MODE === "noncommercial";
  const commercialApproved = process.env.JAMENDO_COMMERCIAL_APPROVED === "true";
  if (!nonCommercialMode && !commercialApproved) {
    return reply.code(503).send(authError(503, "Jamendo is disabled until non-commercial mode is explicitly selected or commercial API permission is approved."));
  }
  if (!clientId) return reply.code(503).send(authError(503, "Jamendo catalog is not configured yet."));
  const q = request.query.q?.trim().slice(0, 100) ?? "";
  const trackId = request.query.id?.trim() ?? "";
  if (trackId && !/^[0-9]{1,24}$/.test(trackId)) {
    return reply.code(400).send(authError(400, "A valid Jamendo track ID is required."));
  }
  const limit = trackId ? 1 : Math.min(30, Math.max(1, Number(request.query.limit) || 20));
  const page = Math.min(100, Math.max(1, Number(request.query.page) || 1));
  try {
    const params = new URLSearchParams({
      client_id: clientId,
      format: "json",
      limit: String(limit),
      offset: String((page - 1) * limit),
      order: trackId ? "id" : q ? "relevance" : "popularity_total",
      include: "licenses musicinfo",
      type: "single albumtrack",
      audioformat: "mp32"
    });
    if (trackId) params.set("id", trackId);
    else if (q) params.set("search", q);
    const response = await fetch(`https://api.jamendo.com/v3.0/tracks/?${params.toString()}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) {
      request.log.warn({ status: response.status }, "Jamendo catalog request failed");
      return reply.code(502).send(authError(502, "Music provider is temporarily unavailable."));
    }
    const payload = await response.json() as {
      headers?: { status?: string; results_count?: number };
      results?: Array<{
        id: string; name: string; duration: number; artist_name: string;
        album_name?: string; image?: string; album_image?: string;
        audio?: string; audiodownload?: string; audiodownload_allowed?: boolean; license_ccurl?: string;
        shareurl?: string; releasedate?: string;
      }>;
    };
    const items = (payload.results ?? []).flatMap((track) => {
      const licenseUrl = track.license_ccurl ?? "";
      const normalizedLicenseUrl = licenseUrl.toLowerCase()
        .replace("http://creativecommons.org/", "")
        .replace("https://creativecommons.org/", "")
        .replace("https://www.creativecommons.org/", "");
      const licensePath = normalizedLicenseUrl;
      const isCcZero = licensePath.startsWith("publicdomain/zero/");
      const licenseSlug = licensePath.startsWith("licenses/") ? licensePath.split("/")[1] ?? "" : "";
      const isKnownCcLicense = isCcZero || ["by", "by-sa", "by-nd", "by-nc", "by-nc-sa", "by-nc-nd"].includes(licenseSlug);
      const isNonCommercialLicense = licenseSlug.includes("-nc");
      // Jamendo API access is non-commercial in this deployment. Track-level
      // NC licenses are allowed; unknown licenses are always rejected.
      // Commercial API approval does not override a track's NC license.
      const licenseAllowed = isKnownCcLicense && (nonCommercialMode || !isNonCommercialLicense);
      if (!licenseAllowed || !track.audio || !track.id) return [];
      return [{
        id: track.id,
        providerTrackId: track.id,
        title: track.name,
        artist: track.artist_name,
        album: track.album_name ?? null,
        durationSeconds: track.duration,
        artworkUrl: track.album_image ?? track.image ?? null,
        audioUrl: track.audio,
        downloadUrl: track.audiodownload_allowed === true ? track.audiodownload ?? null : null,
        licenseUrl,
        sourceUrl: track.shareurl ?? `https://www.jamendo.com/track/${track.id}`,
        provider: "Jamendo",
        playable: true
      }];
    });
    let resolvedItems = items;
    if (trackId && items.length === 1) {
      // Single-track resolve: verify the freshly signed stream so callers get a
      // truthful availability flag before they hand the URL to a media element.
      const available = await probeStream(items[0].audioUrl);
      resolvedItems = [{ ...items[0], playable: available, available } as (typeof items)[number] & { available: boolean }];
    }
    return { provider: "Jamendo", items: resolvedItems, page, limit, sourceCount: payload.results?.length ?? 0 };
  } catch (error) {
    request.log.error({ err: error }, "Jamendo catalog unavailable");
    return reply.code(502).send(authError(502, "Music provider is temporarily unavailable."));
  }
});

// Audius public discovery catalog. Read-only endpoints are public; only API-accessible,
// non-gated tracks are returned as playable. The provider remains the audio host.
app.get<{ Querystring: { sort?: string; limit?: string; id?: string } }>("/api/v1/providers/audius/tracks", async (request, reply) => {
  const sort = request.query.sort === "latest" ? "latest" : "trending";
  const trackId = request.query.id?.trim() ?? "";
  const limit = trackId ? 1 : Math.min(30, Math.max(1, Number(request.query.limit) || 24));
  if (trackId && !/^[a-zA-Z0-9_-]{1,64}$/.test(trackId)) {
    return reply.code(400).send(authError(400, "A valid Audius track ID is required."));
  }
  try {
    const params = new URLSearchParams({ limit: String(limit), app_name: "SONORA" });
    if (sort === "trending" && !trackId) params.set("time", "week");
    const path = trackId ? `tracks/${encodeURIComponent(trackId)}` : `tracks/${sort}`;
    const response = await fetch(`https://api.audius.co/v1/${path}?${params.toString()}`, {
      headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json() as { data?: Array<{
      id: string; title: string; duration?: number; permalink?: string; is_streamable?: boolean;
      is_stream_gated?: boolean; license?: string; artwork?: Record<string, string> | null;
      user?: { name?: string; handle?: string }; album?: { playlist_name?: string };
    }> | {
      id: string; title: string; duration?: number; permalink?: string; is_streamable?: boolean;
      is_stream_gated?: boolean; license?: string; artwork?: Record<string, string> | null;
      user?: { name?: string; handle?: string }; album?: { playlist_name?: string };
    } };
    const records = Array.isArray(payload.data) ? payload.data : payload.data ? [payload.data] : [];
    const items = records.flatMap((track) => {
      if (!track.id || !track.title || track.is_streamable !== true || track.is_stream_gated === true) return [];
      return [{
        id: `audius:${track.id}`, providerTrackId: track.id, title: track.title,
        artist: track.user?.name ?? track.user?.handle ?? "Audius creator",
        album: track.album?.playlist_name ?? null, durationSeconds: track.duration ?? 0,
        artworkUrl: track.artwork?.["480x480"] ?? track.artwork?.["150x150"] ?? null,
        audioUrl: `https://api.audius.co/v1/tracks/${encodeURIComponent(track.id)}/stream?app_name=SONORA`,
        licenseUrl: typeof track.license === "string" && track.license.startsWith("http") ? track.license : "https://audius.co/terms",
        sourceUrl: audiusPublicPage(track.permalink), provider: "Audius", playable: true
      }];
    });
    return { provider: "Audius", sort, items, sourceCount: records.length };
  } catch (error) {
    request.log.warn({ err: error }, "Audius discovery catalog unavailable");
    return reply.code(502).send(authError(502, "Audius catalog is temporarily unavailable."));
  }
});

app.get<{ Querystring: { id?: string } }>("/api/v1/providers/commons/tracks", async (request, reply) => {
  try {
    const track = await commonsCatalog.lookup(request.query.id ?? "");
    return { items: track ? [track] : [] };
  } catch {
    return reply.code(502).send(authError(502, "Wikimedia Commons is temporarily unavailable."));
  }
});

app.get<{ Querystring: { q?: string; type?: string; limit?: string; inApp?: string } }>("/api/v1/search/music", async (request, reply) => {
  const q = request.query.q?.trim().slice(0, 100) ?? "";
  const type = request.query.type ?? "all";
  const limit = Math.min(20, Math.max(1, Number(request.query.limit) || 12));
  const inApp = request.query.inApp === "true";
  if (q.length < 2) return reply.code(400).send(authError(400, "Search query must contain at least two characters."));
  if (!["all", "tracks", "artists"].includes(type)) return reply.code(400).send(authError(400, "Search type must be all, tracks or artists."));

  const tracks: Array<Record<string, unknown>> = [];
  const metadata: Array<Record<string, unknown>> = [];
  const spotifyMetadata: Array<Record<string, unknown>> = [];
  const artists: Array<Record<string, unknown>> = [];
  const providers: Record<string, { ok: boolean; count: number; error?: string }> = {};
  const queryKey = catalogSearchKey(q);
  const queryIsrc = validIsrc(q.replace(/^isrc:\s*/i, ""));
  const officialReleases = inApp && type !== "artists" ? searchOfficialReleases(q, limit) : [];

  const audiusUsers = (async () => {
    if (!inApp && type === "tracks") return [];
    try {
      const params = new URLSearchParams({ query: q, limit: String(limit), app_name: "SONORA" });
      const response = await fetch(`https://api.audius.co/v1/users/search?${params}`, {
        headers: { Accept: "application/json" }, signal: AbortSignal.timeout(4500)
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json() as { data?: Array<{
        id: string; name?: string; handle?: string; follower_count?: number; track_count?: number;
        profile_picture?: Record<string, string> | null;
      }> };
      const users = (payload.data ?? []).filter((user) => user.id && (user.name || user.handle) &&
        (!inApp || matchesCatalogSearch(q, user.name) || matchesCatalogSearch(q, user.handle)));
      providers.audiusArtists = { ok: true, count: users.length };
      return users;
    } catch (error) {
      providers.audiusArtists = { ok: false, count: 0, error: error instanceof Error ? error.message : "Provider unavailable" };
      return [];
    }
  })();

  const tasks: Array<Promise<void>> = [];
  if (licensedCatalog.configured) {
    tasks.push((async () => {
      try {
        const matches = await licensedCatalog.search(q, limit, type === "artists");
        if (type !== "artists") tracks.unshift(...matches);
        if (inApp || type !== "tracks") {
          const artistNames = new Map(matches.filter((item) => matchesCatalogSearch(q, item.artist))
            .map((item) => [catalogSearchKey(item.artist), item.artist]));
          for (const [key, name] of artistNames) {
            artists.push({ id: `sonora-artist:${key}`, provider: "SONORA", name });
          }
        }
        providers.sonora = { ok: true, count: matches.length };
      } catch {
        providers.sonora = { ok: false, count: 0, error: "Licensed catalog temporarily unavailable." };
      }
    })());
  }
  if (type !== "artists") {
    if (inApp) {
      tasks.push((async () => {
        try {
          const matches = await commonsCatalog.search(q, limit);
          tracks.push(...matches);
          providers.commons = { ok: true, count: matches.length };
        } catch {
          providers.commons = { ok: false, count: 0, error: "Wikimedia Commons is temporarily unavailable." };
        }
      })());
    }
    if (!inApp && process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET && process.env.SPOTIFY_CATALOG_MARKET) {
      tasks.push((async () => {
        const report = await runDiscoverySearch(q, limit, "commercial_streaming", process.env);
        providers.spotify = report.providers.commercial_streaming;
        for (const { best } of report.groups) {
          spotifyMetadata.push({
            id: `spotify:${best.externalId}`, provider: "Spotify", title: best.title,
            artist: best.artist, album: best.album, durationSeconds: best.durationSeconds,
            sourceUrl: best.sourcePageUrl, isrc: best.isrc, playable: false
          });
        }
      })());
    }
    tasks.push((async () => {
      const jamendo = jamendoConfig();
      if (!jamendo) {
        providers.jamendo = { ok: false, count: 0, error: "Jamendo catalog is not configured." };
        return;
      }
      const clientId = jamendo.clientId;
      try {
        const params = new URLSearchParams({
          client_id: clientId, format: "json", limit: String(limit), order: "relevance",
          include: "licenses musicinfo", type: "single albumtrack", audioformat: "mp32", search: q
        });
        const response = await fetch(`https://api.jamendo.com/v3.0/tracks/?${params.toString()}`, { signal: AbortSignal.timeout(9000) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json() as { results?: Array<{
          id: string; name: string; duration: number; artist_name: string; album_name?: string;
          image?: string; album_image?: string; audio?: string; audiodownload?: string; audiodownload_allowed?: boolean; license_ccurl?: string; shareurl?: string;
        }>; headers?: { status?: string; error?: string } };
        if (payload.headers?.status === "error") throw new Error(payload.headers.error || "Jamendo API rejected the request.");
        for (const track of payload.results ?? []) {
          const licenseUrl = track.license_ccurl ?? "";
          if (!track.audio || !track.id || !jamendoLicenseAllowed(licenseUrl, jamendo.nonCommercial)) continue;
          tracks.push({
            id: `jamendo:${track.id}`, providerTrackId: track.id, provider: "Jamendo",
            title: track.name, artist: track.artist_name, album: track.album_name ?? null,
            durationSeconds: track.duration, artworkUrl: track.album_image ?? track.image ?? null,
            audioUrl: track.audio, downloadUrl: track.audiodownload_allowed === true ? track.audiodownload ?? null : null, licenseUrl, sourceUrl: track.shareurl ?? `https://www.jamendo.com/track/${track.id}`,
            playable: true, rightsLabel: "Creative Commons"
          });
        }
        providers.jamendo = { ok: true, count: tracks.filter((item) => item.provider === "Jamendo").length };
      } catch (error) {
        providers.jamendo = { ok: false, count: 0, error: error instanceof Error ? error.message : "Provider unavailable" };
      }
    })());
    tasks.push((async () => {
      try {
        type AudiusTrack = {
          id: string; title: string; duration?: number; permalink?: string; is_streamable?: boolean;
          is_stream_gated?: boolean; license?: string; artwork?: Record<string, string> | null;
          user?: { id?: string; name?: string; handle?: string }; album?: { playlist_name?: string };
        };
        async function fetchTracks(path: string, params: URLSearchParams): Promise<AudiusTrack[]> {
          const response = await fetch(`https://api.audius.co/v1/${path}?${params}`, {
            headers: { Accept: "application/json" }, signal: AbortSignal.timeout(4500)
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const payload = await response.json() as { data?: AudiusTrack[] };
          return payload.data ?? [];
        }
        const queryResults = Promise.allSettled([
          fetchTracks("tracks/search", new URLSearchParams({ query: q, limit: String(limit), app_name: "SONORA" }))
        ]);
        const exactAccounts = inApp && queryKey ? (await audiusUsers)
          .filter((user) => [user.name, user.handle].some((name) => catalogSearchKey(name) === queryKey))
          .filter((user) => user.track_count !== 0).slice(0, 2) : [];
        const [search, uploads] = await Promise.all([
          queryResults,
          Promise.allSettled(exactAccounts.map(async (user) => {
            const items = await fetchTracks(`users/${encodeURIComponent(user.id)}/tracks`,
              new URLSearchParams({ limit: String(limit), app_name: "SONORA" }));
            return items.filter((item) => item.user?.id === user.id);
          }))
        ]);
        const resolved = [...uploads, ...search].flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
        if (!resolved.length) throw new Error("Audius track search unavailable");
        const included = new Set<string>();
        for (const track of resolved.flat()) {
          if (!track.id || !track.title) continue;
          const artist = track.user?.name ?? track.user?.handle ?? "Audius creator";
          const sourceUrl = audiusPublicPage(track.permalink, track.user?.handle);
          const streamable = track.is_streamable === true && track.is_stream_gated !== true &&
            (!track.duration || track.duration <= PLAYABLE_MAX_DURATION_SECONDS);
          if (included.has(track.id) || inApp && !streamable) continue;
          included.add(track.id);
          tracks.push({
            id: `audius:${track.id}`, providerTrackId: track.id, provider: "Audius",
            title: track.title, artist, artistId: track.user?.id, artistHandle: track.user?.handle,
            album: track.album?.playlist_name ?? null,
            durationSeconds: track.duration ?? 0,
            artworkUrl: track.artwork?.["480x480"] ?? track.artwork?.["150x150"] ?? null,
            audioUrl: streamable ? `https://api.audius.co/v1/tracks/${encodeURIComponent(track.id)}/stream?app_name=SONORA` : "",
            licenseUrl: typeof track.license === "string" && track.license.startsWith("http") ? track.license : "https://audius.co/terms",
            sourceUrl, playable: streamable, rightsLabel: track.license ?? "Audius platform terms"
          });
        }
        providers.audius = { ok: true, count: included.size };
      } catch (error) {
        providers.audius = { ok: false, count: 0, error: error instanceof Error ? error.message : "Provider unavailable" };
      }
    })());
    tasks.push((async () => {
      try {
        const params = new URLSearchParams({ query: queryIsrc ? `isrc:${queryIsrc}` : q, fmt: "json", limit: String(limit) });
        const response = await fetch(`https://musicbrainz.org/ws/2/recording/?${params.toString()}`, {
          headers: { Accept: "application/json", "User-Agent": "SONORA/0.2 (music discovery app)" },
          signal: AbortSignal.timeout(9000)
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json() as { recordings?: Array<{
          id: string; title: string; length?: number; isrcs?: string[]; "first-release-date"?: string;
          "artist-credit"?: Array<{ name?: string; joinphrase?: string; artist?: { name?: string } }>;
          releases?: Array<{ title?: string }>;
        }> };
        for (const item of payload.recordings ?? []) {
          const isrcs = (item.isrcs ?? []).map(validIsrc).filter((code): code is string => code !== null);
          if (queryIsrc && !isrcs.includes(queryIsrc)) continue;
          metadata.push({
            id: item.id, provider: "MusicBrainz", title: item.title,
            artist: (item["artist-credit"] ?? []).map((credit, index) => {
              const name = credit.name ?? credit.artist?.name ?? "";
              return name + (credit.joinphrase ?? (index < (item["artist-credit"]?.length ?? 0) - 1 ? " " : ""));
            }).join("").trim(),
            album: item.releases?.[0]?.title ?? null, durationSeconds: item.length ? Math.round(item.length / 1000) : null,
            releaseDate: item["first-release-date"] ?? null,
            sourceUrl: `https://musicbrainz.org/recording/${item.id}`, isrc: queryIsrc ?? isrcs[0] ?? null, playable: false
          });
        }
        providers.musicbrainz = { ok: true, count: metadata.length };
      } catch (error) {
        providers.musicbrainz = { ok: false, count: 0, error: error instanceof Error ? error.message : "Provider unavailable" };
      }
    })());
  }
  if (inApp || type !== "tracks") {
    tasks.push((async () => {
      for (const user of await audiusUsers) {
        artists.push({
          id: `audius-user:${user.id}`, provider: "Audius", name: user.name ?? user.handle,
          handle: user.handle ?? null, followerCount: user.follower_count ?? null, trackCount: user.track_count ?? null,
          imageUrl: user.profile_picture?.["150x150"] ?? null,
          sourceUrl: user.handle ? `https://audius.co/${user.handle}` : "https://audius.co"
        });
      }
    })());
    if (type === "artists" || type === "all") {
      tasks.push((async () => {
        try {
          const params = new URLSearchParams({ query: q, fmt: "json", limit: String(limit) });
          const response = await fetch(`https://musicbrainz.org/ws/2/artist/?${params.toString()}`, {
            headers: { Accept: "application/json", "User-Agent": "SONORA/0.2 (music discovery app)" },
            signal: AbortSignal.timeout(9000)
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const payload = await response.json() as { artists?: Array<{
            id: string; name: string; country?: string; disambiguation?: string; type?: string;
          }> };
          for (const artist of payload.artists ?? []) {
            if (!artist.id || !artist.name) continue;
            artists.push({
              id: `musicbrainz-artist:${artist.id}`, provider: "MusicBrainz", name: artist.name,
              country: artist.country ?? null, description: artist.disambiguation ?? artist.type ?? null,
              sourceUrl: `https://musicbrainz.org/artist/${artist.id}`
            });
          }
          providers.musicbrainzArtists = { ok: true, count: artists.filter((artist) => artist.provider === "MusicBrainz").length };
        } catch (error) {
          providers.musicbrainzArtists = { ok: false, count: 0, error: error instanceof Error ? error.message : "Provider unavailable" };
        }
      })());
    }
  }
  await Promise.all(tasks);
  if (queryIsrc && type !== "artists" && providers.musicbrainz?.ok === false && ![...spotifyMetadata, ...tracks].some((item) => item.isrc === queryIsrc)) {
    return reply.code(503).send({ ...authError(503, "Поиск по ISRC сейчас недоступен. Попробуйте позже или введите название трека."), providers });
  }
  const anySuccess = officialReleases.length > 0 || Object.values(providers).some((provider) => provider.ok);
  if (!anySuccess) return reply.code(502).send({ ...authError(502, "All music catalog providers are temporarily unavailable."), providers });
  if (inApp) {
    const matchingArtists = artists.filter((artist) => matchesCatalogSearch(q, artist.name) || matchesCatalogSearch(q, artist.handle));
    const relevantMetadata = metadata.filter((item) => queryIsrc ? item.isrc === queryIsrc : matchesCatalogSearch(q, item.artist, item.title, item.album));
    const exactProfiles = matchingArtists.filter((artist) =>
      [artist.name, artist.handle].some((value) => catalogSearchKey(value) === queryKey));
    const exactAudiusIds = new Set(exactProfiles.filter((artist) => artist.provider === "Audius").map((artist) => artist.id));
    const exactArtist = exactProfiles.length > 0 ||
      relevantMetadata.some((item) => catalogSearchKey(item.artist) === queryKey);
    const matchingMetadata = exactArtist
      ? relevantMetadata.filter((item) => matchesCatalogSearch(q, item.artist))
      : relevantMetadata;
    const creditsMatch = (track: Record<string, unknown>) =>
      track.provider === "Audius" && exactAudiusIds.size > 0
        ? exactAudiusIds.has(`audius-user:${track.artistId}`)
        : [track.artist, track.artistHandle].some((value) => catalogSearchKey(value) === queryKey);
    const playable = tracks.filter((track) =>
      track.playable === true && typeof track.audioUrl === "string" && track.audioUrl.startsWith("https://") &&
      (queryIsrc ? track.isrc === queryIsrc : creditsMatch(track) || !exactArtist && !hasUncreditedArtistPrefix(queryKey, track.title) &&
        matchesCatalogSearch(q, track.artist, track.title, track.album)));
    return {
      query: q, type, tracks: playable.slice(0, limit * 2), metadata: matchingMetadata.slice(0, limit),
      artists: matchingArtists.slice(0, limit), officialReleases, providers
    };
  }
  return {
    query: q, type, tracks: tracks.slice(0, limit * 2), metadata: [...spotifyMetadata, ...metadata].slice(0, limit),
    artists: artists.slice(0, limit), providers
  };
});

// Personalized recommendations built from real listening behavior: favorites,
// play/complete/skip events and measured listening time. Ranking is the
// deterministic, network-free core shared with unit tests.
import { rankRecommendations, type TasteSignal } from "./recommendation-core.js";
// Licensed-catalog helpers (Jamendo/Audius) now live in the shared catalog
// module so the import service and the core routes use identical access.
import {
  audiusCandidates, audiusPublicPage, PLAYABLE_MAX_DURATION_SECONDS, catalogSearchKey, hasUncreditedArtistPrefix, jamendoCandidates,
  jamendoConfig, jamendoLicenseAllowed, matchesCatalogSearch, type JamendoCandidate
} from "./catalog.js";
import { registerImportRoutes } from "./import-routes.js";
// Universal Music Discovery & Import Engine: adapters, grouping, resolve.
import { registerDiscoveryRoutes, runDiscoverySearch, validIsrc } from "./discovery.js";

app.get<{ Querystring: { limit?: string } }>("/api/v1/recommendations", async (request, reply) => {
  const limit = Math.min(40, Math.max(4, Number(request.query.limit) || 20));
  const auth = await requireUser(request, reply);
  if (!auth) return;
  const taste: TasteSignal[] = [];
  const heardIds = new Set<string>();
  const { data: favorites } = await auth.client.from("user_provider_favorites")
    .select("provider_track_id,artist_name").eq("user_id", auth.user.id).limit(100);
  for (const favorite of favorites ?? []) {
    taste.push({ artist: favorite.artist_name, liked: true });
    heardIds.add(`jamendo:${favorite.provider_track_id}`);
  }
  const { data: events } = await auth.client.from("provider_listening_events")
    .select("provider_track_id,artist_name,event_type,listened_ms").eq("user_id", auth.user.id)
    .order("occurred_at", { ascending: false }).limit(300);
  const playsByArtist = new Map<string, number>();
  for (const event of events ?? []) {
    if (event.event_type === "skip" && (event.listened_ms ?? 0) < 20000) {
      taste.push({ artist: event.artist_name, skipped: true });
    } else {
      playsByArtist.set(event.artist_name, (playsByArtist.get(event.artist_name) ?? 0) + 1);
    }
    heardIds.add(`jamendo:${event.provider_track_id}`);
  }
  for (const [artist, plays] of playsByArtist) taste.push({ artist, plays });
  const topArtists = [...playsByArtist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4)
    .map(([artist]) => artist);
  const favoriteArtists = (favorites ?? []).map((favorite) => favorite.artist_name).slice(0, 3);
  const queries = [...new Set([...topArtists, ...favoriteArtists])].slice(0, 5);
  const pools = await Promise.all([
    ...queries.map((query) => jamendoCandidates(query, 12)),
    // A trending pool keeps first-run users (no history yet) supplied with
    // popular licensed tracks instead of an empty screen.
    jamendoCandidates("", Math.max(limit, 24), "popularity_total")
  ]);
  const seen = new Set<string>();
  const candidates: JamendoCandidate[] = [];
  for (const pool of pools) {
    for (const track of pool) {
      if (heardIds.has(track.id) || seen.has(track.id)) continue;
      seen.add(track.id);
      candidates.push(track);
    }
  }
  if (candidates.length === 0) {
    return reply.code(503).send(authError(503, "Recommendation catalogs are temporarily unavailable."));
  }
  const ranked = rankRecommendations(candidates, taste, limit);
  return {
    personalized: taste.length > 0,
    basedOn: topArtists.slice(0, 4),
    items: ranked.map(({ score, reasons, ...track }) => ({ ...track, score, reasons }))
  };
});

// SONORA music assistant. Intent parsing works without an LLM via a deterministic RU/EN
// intent parser over the licensed catalogs; upgrades to an LLM only when the
// operator provides their own OPENAI_API_KEY (service stays free by default).
import { parseAssistantMessage, type AssistantIntent } from "./assistant-core.js";
import { speechConfig, synthesizeAssistantVoice } from "./assistant-voice.js";

app.post<{ Body: { text?: string; persona?: string } }>("/api/v1/assistant/speech", {
  bodyLimit: 4096,
  config: { rateLimit: { max: 12, timeWindow: "1 minute" } }
}, async (request, reply) => {
  const config = speechConfig(process.env);
  if (!config) return reply.code(503).send(authError(503, "Облачный голос не настроен."));
  const account = await requireUser(request, reply);
  if (!account) return;
  const allowedUsers = process.env.SONORA_AZURE_SPEECH_USER_IDS?.split(",").map((id) => id.trim()).filter(Boolean) ?? [];
  if (allowedUsers.length && !allowedUsers.includes(account.user.id)) {
    return reply.code(403).send(authError(403, "Облачный голос недоступен для этого аккаунта."));
  }
  const text = typeof request.body?.text === "string" ? request.body.text.trim() : "";
  if (!text || text.length > 900) return reply.code(400).send(authError(400, "Текст озвучивания должен содержать от 1 до 900 символов."));
  try {
    const audio = await synthesizeAssistantVoice(text, config, request.body?.persona);
    return reply.header("Cache-Control", "private, no-store").type("audio/mpeg").send(audio);
  } catch {
    return reply.code(502).send(authError(502, "Облачный голос временно недоступен."));
  }
});

async function assistantViaLlm(message: string): Promise<AssistantIntent | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  const baseUrl = process.env.OPENAI_API_BASE ?? "https://api.openai.com/v1";
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
        messages: [
          { role: "system", content: 'Classify a music assistant request. Reply ONLY with JSON {"action":"search|create_playlist|similar|explain|greeting","query":"catalog search terms","label":"short human label","playlistName":"only for create_playlist"}. Use Russian for label and playlistName. Preserve artist and track names in their original language. Translate only generic mood/genre search terms.' },
          { role: "user", content: message }
        ],
        temperature: 0, max_tokens: 120, response_format: { type: "json_object" }
      }),
      signal: AbortSignal.timeout(12000)
    });
    if (!response.ok) return null;
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const parsed = JSON.parse(payload.choices?.[0]?.message?.content ?? "{}") as Partial<AssistantIntent>;
    if (!parsed.action || !["search", "create_playlist", "similar", "explain", "greeting"].includes(parsed.action)) return null;
    return {
      action: parsed.action,
      query: typeof parsed.query === "string" ? parsed.query.slice(0, 100) : "",
      label: typeof parsed.label === "string" ? parsed.label.slice(0, 60) : "assistant",
      playlistName: typeof parsed.playlistName === "string" ? parsed.playlistName.slice(0, 80) : undefined
    };
  } catch {
    return null;
  }
}
app.post<{ Body: { message?: string } }>("/api/v1/assistant", writeRateLimit, async (request, reply) => {
  const message = typeof request.body?.message === "string" ? request.body.message.trim().slice(0, 300) : "";
  if (message.length < 2) return reply.code(400).send(authError(400, "Напишите настроение, название трека или исполнителя."));
  const bearer = request.headers.authorization;
  const auth = bearer ? await requireUser(request, reply) : null;
  if (bearer && !auth) return; // token was present but invalid
  const intent = (await assistantViaLlm(message)) ?? parseAssistantMessage(message);
  if (intent.action === "greeting") {
    return { reply: "Подберу музыку по настроению и вашим вкусам. Попробуйте: «микс для пробежки» или «найди спокойное фортепиано».", intent, tracks: [] };
  }
  if (intent.action === "explain") {
    if (!auth) {
      return { reply: "Войдите в аккаунт: для персональной подборки нужны ваши прослушивания, пропуски и избранное. Пока попробуйте подборку по настроению.", intent, tracks: [] };
    }
    const { items } = await (async () => {
      const taste: TasteSignal[] = [];
      const { data: favorites } = await auth.client.from("user_provider_favorites").select("artist_name").eq("user_id", auth.user.id).limit(30);
      for (const favorite of favorites ?? []) taste.push({ artist: favorite.artist_name, liked: true });
      const { data: events } = await auth.client.from("provider_listening_events").select("artist_name,event_type,listened_ms").eq("user_id", auth.user.id).order("occurred_at", { ascending: false }).limit(200);
      const plays = new Map<string, number>();
      for (const event of events ?? []) {
        if (event.event_type === "skip" && (event.listened_ms ?? 0) < 20000) taste.push({ artist: event.artist_name, skipped: true });
        else plays.set(event.artist_name, (plays.get(event.artist_name) ?? 0) + 1);
      }
      for (const [artist, count] of plays) taste.push({ artist, plays: count });
      const favoriteArtists = (favorites ?? []).map((favorite) => favorite.artist_name as string);
      const seeds = [...new Set([...favoriteArtists, ...[...plays.entries()].sort((a, b) => b[1] - a[1]).map(([artist]) => artist)])].slice(0, 4);
      const pools = await Promise.allSettled([...seeds.map((artist) => jamendoCandidates(artist, 12)), jamendoCandidates("", 24, "popularity_total")]);
      const pool = pools.flatMap((result) => result.status === "fulfilled" ? result.value : []);
      return { items: rankRecommendations(pool, taste, 15) };
    })();
    const topReasons = items.slice(0, 3).map((item) => `“${item.title}” — ${item.reasons.join(", ") || "из доступного каталога"}`);
    return {
      reply: topReasons.length
        ? `Подборка с учётом ваших прослушиваний: ${topReasons.join("; ")}.`
        : "Пока мало данных о ваших вкусах. Слушайте музыку и добавляйте любимые треки в избранное.",
      intent, tracks: items.map(({ score, reasons, ...track }) => ({ ...track, reasons }))
    };
  }
  if (intent.action === "search") {
    const [catalog, jamendo] = await Promise.allSettled([
      app.inject({ method: "GET", url: `/api/v1/search/music?${new URLSearchParams({ q: intent.query, type: "tracks", inApp: "true" })}` }),
      jamendoCandidates(intent.query, 15)
    ]);
    const catalogResult = catalog.status === "fulfilled"
      ? catalog.value.json<{ tracks?: Array<Record<string, unknown>>; providers?: Record<string, { ok: boolean; count: number }> }>() : null;
    const found = catalog.status === "fulfilled" && catalog.value.statusCode === 200 ? catalogResult?.tracks ?? [] : [];
    const sources = Object.fromEntries(Object.entries(catalogResult?.providers ?? {}).map(([name, provider]) => [name, { ok: provider.ok, count: provider.count }]));
    const partial = Object.values(sources).some((source) => !source.ok) || catalog.status === "rejected";
    const tracks = [...found, ...(jamendo.status === "fulfilled" ? jamendo.value : [])]
      .filter((track, index, all) => track.playable !== false && typeof track.audioUrl === "string" && track.audioUrl.startsWith("https://") && all.findIndex((item) => item.id === track.id) === index).slice(0, 15);
    const allUnavailable = !tracks.length && !Object.values(sources).some((source) => source.ok);
    if (allUnavailable) return reply.code(503).send({ error: "Музыкальные источники сейчас недоступны. Попробуйте повторить запрос позже.", intent, tracks: [], sources, partial: true });
    return { reply: tracks.length
      ? `Нашёл треки для вас. Нажмите «Слушать подборку» или скажите «слушать».${partial ? " Часть источников недоступна, выдача может быть неполной." : ""}`
      : partial ? "В доступных источниках звук не найден. Часть каталогов сейчас недоступна — можно повторить поиск позже."
      : "В проверенных каталогах доступный звук не найден. Попробуйте уточнить название или выбрать другое настроение.", intent, tracks, sources, partial };

  }
  let candidates = await jamendoCandidates(intent.query, 24);
  if (!candidates.length) candidates = await audiusCandidates(intent.query, 20);
  let personalized = false;
  if (auth && candidates.length) {
    const { data: favorites, error } = await auth.client.from("user_provider_favorites")
      .select("artist_name").eq("user_id", auth.user.id).limit(100);
    if (!error && favorites?.length) {
      const taste: TasteSignal[] = favorites.map((favorite) => ({ artist: favorite.artist_name, liked: true }));
      const byId = new Map(candidates.map((track) => [track.id, track]));
      candidates = rankRecommendations(candidates, taste, 24).map((track) => byId.get(track.id)!);
      personalized = true;
    }
  }
  if (candidates.length === 0) {
    return { reply: "Не удалось найти доступные треки. Попробуйте другое настроение или исполнителя; источник также может быть временно недоступен.", intent, tracks: [] };
  }
  let playlist: { id: string; name: string } | null = null;
  if (intent.action === "create_playlist") {
    if (!auth) {
      return {
        reply: `Подборка «${intent.label}» готова. Чтобы сохранить её в медиатеке, войдите и повторите запрос.`,
        intent, tracks: candidates.slice(0, 15)
      };
    }
    const name = (intent.playlistName ?? `${intent.label} mix`).slice(0, 80);
    const { data: created, error: createError } = await auth.client.from("playlists").insert({
      owner_id: auth.user.id, title: name, description: `Created by the SONORA assistant from: ${message.slice(0, 120)}`, is_public: false
    }).select("id,title").single();
    if (createError || !created) {
      return { reply: "Треки найдены, но сохранить плейлист не удалось. Попробуйте ещё раз.", intent, tracks: candidates.slice(0, 15) };
    }
    const chosen = candidates.slice(0, 15);
    const rows = chosen.map((track, index) => ({
      playlist_id: created.id, provider: track.provider.toLowerCase(), provider_track_id: track.providerTrackId,
      title: track.title, artist_name: track.artist, album_name: track.album,
      duration_seconds: track.durationSeconds ?? 0, artwork_url: track.artworkUrl,
      license_url: track.licenseUrl || (track.provider === "Audius" ? "https://audius.co/terms" : "https://jamendo.com/legal/license"), source_url: track.sourceUrl,
      position: index
    }));
    const { error: addError } = await auth.client.from("provider_playlist_tracks").insert(rows);
    if (addError) {
      await auth.client.from("playlists").delete().eq("id", created.id).eq("owner_id", auth.user.id);
      return { reply: "Не удалось сохранить треки в плейлист. Подборку можно прослушать здесь.", intent, tracks: chosen };
    }
    playlist = { id: created.id, name: created.title };
  }
  return {
    reply: playlist
      ? `Сохранён плейлист «${playlist.name}». Треков: ${Math.min(15, candidates.length)}.`
      : intent.action === "similar"
        ? `Результаты по запросу «${intent.label}»:`
        : `Подборка «${intent.label}» готова к прослушиванию:`,
    intent, tracks: candidates.slice(0, 15), playlist, personalized
  };
});

// Server-side music import from other platforms (public links + export files).
registerImportRoutes(app);
// Multi-source discovery (GET /discovery/search, POST /discovery/resolve).
licensedCatalog.register(app);
registerLyricsRoutes(app, process.env);
registerDiscoveryRoutes(app, licensedCatalog, commonsCatalog);

try {
  registerProfileRoutes(app, { authClient, authError, requireUser });

await app.listen({ port, host });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
