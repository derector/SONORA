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
    "/api/v1/auth/logout"
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
    if (error || !data.session) return reply.code(401).send(authError(401, "Session expired. Please sign in again."));
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

  try {
    const { error } = await authClient(accessToken).auth.signOut({ scope: "local" });
    if (error) return reply.code(400).send(authError(400, "Could not end this session."));
    return { ok: true };
  } catch (error) {
    request.log.error({ err: error }, "Logout unavailable");
    return reply.code(503).send(authError(503, "Authentication service is temporarily unavailable."));
  }
});

try {
  await app.listen({ port, host });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
