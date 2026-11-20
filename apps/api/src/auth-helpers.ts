// Shared Supabase-auth plumbing for SONORA API routes. Moved verbatim from
// index.ts so the import routes reuse the exact same session validation.
import type { FastifyReply, FastifyRequest } from "fastify";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_PUBLISHABLE_KEY;

export function authClient(accessToken?: string): SupabaseClient {
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

export function cleanText(value: unknown, min: number, max: number): value is string {
  return typeof value === "string" && value.trim().length >= min && value.trim().length <= max;
}

export function authError(statusCode: number, message: string) {
  return { statusCode, error: message };
}

export async function requireUser(request: FastifyRequest, reply: FastifyReply) {
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
