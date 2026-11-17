-- Jamendo listening events use provider IDs rather than first-party UUID track IDs.
CREATE TABLE public.provider_listening_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider = 'jamendo'),
  provider_track_id TEXT NOT NULL CHECK (length(provider_track_id) BETWEEN 1 AND 64),
  title TEXT NOT NULL,
  artist_name TEXT NOT NULL,
  album_name TEXT,
  duration_seconds INTEGER CHECK (duration_seconds IS NULL OR duration_seconds > 0),
  artwork_url TEXT,
  license_url TEXT NOT NULL,
  source_url TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('play', 'complete', 'skip')),
  listened_ms INTEGER NOT NULL DEFAULT 0 CHECK (listened_ms >= 0 AND listened_ms <= 86400000),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX provider_listening_events_user_time_idx
  ON public.provider_listening_events (user_id, occurred_at DESC);
CREATE INDEX provider_listening_events_track_idx
  ON public.provider_listening_events (provider, provider_track_id);
ALTER TABLE public.provider_listening_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read their own provider listening history"
  ON public.provider_listening_events FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);
CREATE POLICY "Users can add their own provider listening history"
  ON public.provider_listening_events FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);
