# SONORA Messenger — migration architecture (draft)

Status: planning / implementation branch only. Production main, existing users, data, APK and deployments remain unchanged.

## Verified baseline
- Android: Kotlin, Compose, Media3, Room, OkHttp, WorkManager, encrypted token storage; minSdk 26.
- Web: Next.js 15 / React 19.
- API: Fastify 5 / TypeScript, Supabase Auth and profile routes.
- Email login: existing Supabase email OTP, 8-digit verification endpoint. Reuse current identity, session and profile.
- Download site: standalone Vite app. OTA depends on existing Android package identity, signing certificate, version and GitHub Releases.

## Target product
Android and Web clients for direct messages, group chats, channels, attachments, reactions, replies, edits, deletions, read receipts, presence, search, push, calls (later). Single backend identity and cross-device history.

## Data model (proposed, not deployed)
- conversations(id uuid PK, kind direct|group|channel, title, avatar, created_by, created_at, updated_at)
- conversation_members(conversation_id, user_id, role owner|admin|member, joined_at, last_read_message_id, muted_until, unique(conversation_id,user_id))
- messages(id uuid PK, conversation_id, sender_id, client_nonce, body, reply_to_id, edited_at, deleted_at, created_at, unique(conversation_id,sender_id,client_nonce))
- message_attachments(id, message_id, object_key, mime_type, byte_size, metadata)
- message_reactions(message_id,user_id,emoji, unique(message_id,user_id,emoji))
- user_blocks(blocker_id,blocked_id), user_devices(user_id,device_id,push_token,last_seen_at)
- calls/call_participants added after messaging is stable.

Direct conversations need a canonical unique participant-pair constraint or server-only atomic creation. All timestamps and cursors must support stable pagination. Enforce content-size and media quotas.

## Security invariants
- Existing auth.users IDs remain stable; never delete/recreate accounts.
- RLS on all exposed tables; membership checks for reads, writes, attachments and realtime subscriptions; no service-role key in clients.
- Server validates actor, group permissions, blocking, media type/size, upload authorization and rate limits.
- Private object storage and short-lived signed media URLs; malware screening and abuse reporting before broad rollout.
- Transport TLS; do not claim end-to-end encryption without independently reviewed protocol.
- Idempotent message send with client nonce; monotonic server ordering; safe retries and offline reconciliation.
- No production DB migration or deployment until backups, tests, and explicit release approval.

## API contract v1 (planned)
GET /api/v1/chats?cursor=...
POST /api/v1/chats
GET /api/v1/chats/:id/messages?cursor=...
POST /api/v1/chats/:id/messages (clientNonce, body, replyToId?)
PATCH /api/v1/messages/:id
DELETE /api/v1/messages/:id
POST /api/v1/messages/:id/reactions
POST /api/v1/media/upload-intent
POST /api/v1/media/complete
GET /api/v1/search?q=...
Realtime: authenticated conversation-scoped message events; reconnect via cursor sync.

## Rollout phases
1. Audit existing schemas, deployed services, API contracts, Android package/signing and pending PR dependencies.
2. Add additive SQL migrations and access-control tests; avoid destructive music-table drops.
3. Implement API messaging contracts and realtime authorization with integration tests.
4. Build Web chat UI using existing auth/session proxy.
5. Build Android Compose chat UI, local cache, notifications, offline retry.
6. Add groups/channels, uploads, moderation and search.
7. Add voice/video via WebRTC with signaling and TURN infrastructure.
8. Update download site copy/screenshots only after functional messenger builds exist.
9. Verify signed in-place Android upgrade, old account login, web sessions, backup/rollback; release via explicit approval.

## Definition of first working milestone
Two existing or new email-OTP accounts can exchange persistent messages across web and Android, with enforced membership isolation, reliable reconnect, no data loss and passing automated tests.

## Open decisions
- Existing production Supabase schema/RLS and storage bucket configuration must be inspected before SQL is finalized.
- Push transport, file limits, retention policy, channel discovery, calls/TURN hosting and encryption roadmap require product/security decisions.
