# SONORA Messenger — product requirements and implementation order

Source: user-provided «Как устроен современный мессенджер: от А до Я» (2026-11-23). The source describes typical architectures and externally documented features; it is not a claim that competitors use identical internals.

## Non-negotiable product priorities
- Keep the previously requested Liquid Glass UI, five tint palettes (Ice, Ruby, Amethyst, Emerald, Amber), dark/light mode, high-quality transitions, animations and optional seasonal/weather effects on Android and web.
- Respect reduced-motion, battery, data-saver and weather-location consent.
- Preserve existing Supabase email OTP auth, user IDs, Android package/signing, OTA update continuity.
- Keep music archive `archive/sonora-music-2026-11-23` unchanged. Work only on feature branches; never mutate production or release without verification.
- Two public sites (messenger and APK download) deploy via separate Vercel projects, with SEO/sitemap/robots; **site discovery via search engines is not a requirement to implement people search in the app**.

## Functional scope extracted from source
1. First launch: configuration, local database/cache, device identity, push permissions.
2. Registration: email OTP retained; account/profile, privacy, device sessions.
3. Chat: direct/group/channel, membership roles, invites, permissions, replies, mentions, reactions, forwards, pins, edits/deletes, expiry, view-once where safe.
4. Messaging: durable server persistence, client nonce idempotency, offline queue, reconnect sync, server accepted / device delivered / read states kept distinct, local cache.
5. Media: images, videos, voice notes, audio, documents, stickers; private storage, signed URLs, size/MIME verification, previews.
6. Privacy: TLS not falsely labeled E2EE; blocking, reporting, anti-spam, rate limits, device revocation, retention and backup policy.
7. Calls: separate WebRTC signaling and media path, STUN/TURN, group SFU as required, adaptive codecs, screen share, missed-call notifications.
8. Multi-device: consistent history, event cursors, edits, deletions, receipts, reactions, settings and conflict resolution.
9. Search/archives/filters, public communities and bots/webhooks/Mini Apps only after messaging security is established.
10. Observability: latency, reconnect, push and call quality without logging message plaintext.

## Milestones and acceptance
- M1: two authenticated accounts exchange durable text; membership isolation; offline reconnect; tests.
- M2: responsive Liquid Glass web + Compose Android, theme switching, animation accessibility, optional weather effects.
- M3: groups, reactions, attachments, read receipts, push and media security.
- M4: verified voice/video calls, TURN fallback, device/session security, OTA and APK integrity.
- M5: public website and APK download site on Vercel, SEO and Search Console setup, tested release and rollback.

No fake demo data or nonfunctional controls. Do not claim E2EE without an independently verified implementation. Payments and monetization require separate design and authorization.
