-- 007: Optional idempotency key for listening events so offline-replayed
-- client events are deduplicated instead of double-counted. Fully additive and
-- non-destructive: existing rows keep NULL and are never deduplicated.
ALTER TABLE public.provider_listening_events
  ADD COLUMN IF NOT EXISTS client_event_id TEXT;
ALTER TABLE public.provider_listening_events
  ADD CONSTRAINT provider_listening_events_client_event_id_len
  CHECK (client_event_id IS NULL OR (client_event_id ~ '^[A-Za-z0-9_-]{8,64}$'));
CREATE UNIQUE INDEX IF NOT EXISTS provider_listening_events_client_event_uidx
  ON public.provider_listening_events (user_id, provider, client_event_id)
  WHERE client_event_id IS NOT NULL;

ALTER TABLE public.listening_events
  ADD COLUMN IF NOT EXISTS client_event_id TEXT;
ALTER TABLE public.listening_events
  ADD CONSTRAINT listening_events_client_event_id_len
  CHECK (client_event_id IS NULL OR (client_event_id ~ '^[A-Za-z0-9_-]{8,64}$'));
CREATE UNIQUE INDEX IF NOT EXISTS listening_events_client_event_uidx
  ON public.listening_events (user_id, client_event_id)
  WHERE client_event_id IS NOT NULL;
