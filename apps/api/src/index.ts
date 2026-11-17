import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const app = Fastify({ logger: true, trustProxy: true, bodyLimit: 16_384 });
const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? "0.0.0.0";
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_PUBLISHABLE_KEY;

await app.register(cookie);

await app.register(cors, {
  origin: process.env.CORS_ORIGIN?.split(",").map((value) => value.trim()) ?? ["http://localhost:3000"],
  credentials: true
});

function authClient(accessToken?: string): SupabaseClient {
  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Supabase Auth is not configured on the API service");
  }

  return createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: accessToken
      ? { headers: { Authorization: `Bearer ${accessToken}` } }
      : undefined
  });
}

function validEmail(value: unknown): value is string {
  return typeof value === "string" && value.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function cleanText(value: unknown, min: number, max: number): value is string {
  return typeof value === "string" && value.trim().length >= min && value.trim().length <= max;
}

function authError(statusCode: number, message: string) {
  return { statusCode, error: message };
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
    "/api/v1/catalog/tracks",
    "/api/v1/catalog/search",
    "/api/v1/providers/jamendo/tracks",
    "/api/v1/playlists",
    "/api/v1/playlists/:playlistId",
    "/api/v1/playlists/:playlistId/tracks",
    "/api/v1/playlists/:playlistId/tracks/:trackId",
    "/api/v1/favorites",
    "/api/v1/favorites/:trackId",
    "/api/v1/history"
  ]
}));

app.post<{ Body: { email?: string; username?: string; displayName?: string } }>(
  "/api/v1/auth/register",
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

app.post<{ Body: { email?: string } }>("/api/v1/auth/login", async (request, reply) => {
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

app.post<{ Body: { email?: string; token?: string } }>("/api/v1/auth/verify", async (request, reply) => {
  const { email, token } = request.body ?? {};
  if (!validEmail(email) || typeof token !== "string" || !/^\d{6}$/.test(token)) {
    return reply.code(400).send(authError(400, "Enter the email address and six-digit code."));
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

    reply.setCookie("sonora_refresh", data.session.refresh_token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/api/v1/auth", maxAge: 60 * 60 * 24 * 30 });

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

app.post("/api/v1/auth/refresh", async (request, reply) => {
  const refreshToken = request.cookies.sonora_refresh;
  if (!cleanText(refreshToken, 10, 4096)) {
    return reply.code(400).send(authError(400, "A valid refresh token is required."));
  }

  try {
    const { data, error } = await authClient().auth.refreshSession({ refresh_token: refreshToken });
    if (error || !data.session) {
      reply.clearCookie("sonora_refresh", { path: "/api/v1/auth", httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" });
      return reply.code(401).send(authError(401, "Session expired. Please sign in again."));
    }
    reply.setCookie("sonora_refresh", data.session.refresh_token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/api/v1/auth", maxAge: 60 * 60 * 24 * 30 });
    return {
      ok: true,
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
    return {
      user: {
        id: data.user.id,
        email: data.user.email,
        username: typeof metadata.username === "string" ? metadata.username : null,
        displayName: typeof metadata.display_name === "string" ? metadata.display_name : null
      }
    };
  } catch (error) {
    request.log.error({ err: error }, "Session validation unavailable");
    return reply.code(503).send(authError(503, "Authentication service is temporarily unavailable."));
  }
});

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

async function requireUser(request: import("fastify").FastifyRequest, reply: import("fastify").FastifyReply) {
  const authorization = request.headers.authorization;
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token) {
    await reply.code(401).send(authError(401, "Authentication required."));
    return null;
  }
  try {
    const client = authClient(token);
    const { data, error } = await client.auth.getUser(token);
    if (error || !data.user) {
      await reply.code(401).send(authError(401, "Session is invalid or expired."));
      return null;
    }
    return { client, user: data.user };
  } catch (error) {
    request.log.error({ err: error }, "User authentication unavailable");
    await reply.code(503).send(authError(503, "Authentication service is temporarily unavailable."));
    return null;
  }
}

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
    .select("id,title,description,is_public,created_at,updated_at,playlist_tracks(position,added_at,track:tracks(id,title,duration_ms,artwork_url,playback_provider,playback_reference,rights_status,artist:artists(name),album:albums(title)))")
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

// Jamendo API access is configured for non-commercial use. Known CC BY and
// CC BY-NC variants are accepted; unknown licenses are rejected. Attribution
// and license links are returned with every catalog item.
app.get<{ Querystring: { q?: string; limit?: string; page?: string } }>("/api/v1/providers/jamendo/tracks", async (request, reply) => {
  const clientId = process.env.JAMENDO_CLIENT_ID;
  const nonCommercialMode = process.env.JAMENDO_USE_MODE === "noncommercial";
  const commercialApproved = process.env.JAMENDO_COMMERCIAL_APPROVED === "true";
  if (!nonCommercialMode && !commercialApproved) {
    return reply.code(503).send(authError(503, "Jamendo is disabled until non-commercial mode is explicitly selected or commercial API permission is approved."));
  }
  if (!clientId) return reply.code(503).send(authError(503, "Jamendo catalog is not configured yet."));
  const q = request.query.q?.trim().slice(0, 100) ?? "";
  const limit = Math.min(30, Math.max(1, Number(request.query.limit) || 20));
  const page = Math.min(100, Math.max(1, Number(request.query.page) || 1));
  try {
    const params = new URLSearchParams({
      client_id: clientId,
      format: "json",
      limit: String(limit),
      offset: String((page - 1) * limit),
      order: q ? "relevance" : "popularity_total",
      include: "licenses musicinfo",
      type: "single albumtrack",
      audioformat: "mp32"
    });
    if (q) params.set("search", q);
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
        audio?: string; audiodownload?: string; license_ccurl?: string;
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
        title: track.name,
        artist: track.artist_name,
        album: track.album_name ?? null,
        durationSeconds: track.duration,
        artworkUrl: track.album_image ?? track.image ?? null,
        audioUrl: track.audio,
        licenseUrl,
        sourceUrl: track.shareurl ?? `https://www.jamendo.com/track/${track.id}`,
        provider: "Jamendo"
      }];
    });
    return { provider: "Jamendo", items, page, limit, sourceCount: payload.results?.length ?? 0 };
  } catch (error) {
    request.log.error({ err: error }, "Jamendo catalog unavailable");
    return reply.code(502).send(authError(502, "Music provider is temporarily unavailable."));
  }
});

try {
  await app.listen({ port, host });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
