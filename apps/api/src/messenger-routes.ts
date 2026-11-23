import type { FastifyInstance } from "fastify";
import { requireUser } from "./auth-helpers.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const limit = 50;

export function registerMessengerRoutes(app: FastifyInstance) {
  app.get("/api/v1/messenger/chats", async (request, reply) => {
    const auth = await requireUser(request, reply);
    if (!auth) return;
    const { data, error } = await auth.client.from("messenger_conversations")
      .select("id,kind,title,created_at").order("created_at", { ascending: false }).limit(limit);
    if (error) return reply.code(503).send({ error: "Chats are temporarily unavailable." });
    return { chats: data ?? [] };
  });

  app.get<{ Params: { chatId: string }; Querystring: { before?: string } }>(
    "/api/v1/messenger/chats/:chatId/messages", async (request, reply) => {
      const auth = await requireUser(request, reply);
      if (!auth) return;
      const { chatId } = request.params;
      if (!UUID.test(chatId)) return reply.code(400).send({ error: "Invalid chat ID." });
      const before = request.query.before;
      if (before && (before.length > 40 || !Number.isFinite(Date.parse(before)))) {
        return reply.code(400).send({ error: "Invalid cursor." });
      }
      let query = auth.client.from("messenger_messages")
        .select("id,conversation_id,sender_id,body,created_at,edited_at,deleted_at")
        .eq("conversation_id", chatId).order("created_at", { ascending: false }).limit(limit);
      if (before) query = query.lt("created_at", before);
      const { data, error } = await query;
      if (error) return reply.code(503).send({ error: "Messages are temporarily unavailable." });
      return { messages: data ?? [] };
    }
  );

  app.post<{ Params: { chatId: string }; Body: { body?: unknown; clientNonce?: unknown } }>(
    "/api/v1/messenger/chats/:chatId/messages", async (request, reply) => {
      const auth = await requireUser(request, reply);
      if (!auth) return;
      const { chatId } = request.params;
      const { body, clientNonce } = request.body ?? {};
      if (!UUID.test(chatId) || typeof clientNonce !== "string" || !UUID.test(clientNonce) ||
          typeof body !== "string" || !body.trim() || body.length > 4096) {
        return reply.code(400).send({ error: "Invalid message." });
      }
      // Supabase RLS checks sender identity and membership; never trust client sender IDs.
      const { data, error } = await auth.client.from("messenger_messages")
        .insert({ conversation_id: chatId, sender_id: auth.user.id, client_nonce: clientNonce, body: body.trim() })
        .select("id,conversation_id,sender_id,body,created_at").single();
      if (error?.code === "23505") return reply.code(409).send({ error: "Message already submitted.", clientNonce });
      if (error?.code === "42501") return reply.code(403).send({ error: "Not allowed to post to this chat." });
      if (error) return reply.code(503).send({ error: "Message delivery is temporarily unavailable." });
      return reply.code(201).send({ message: data });
    }
  );
}
