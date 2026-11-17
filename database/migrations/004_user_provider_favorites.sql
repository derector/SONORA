-- Provider favorites preserve external catalog identity without pretending every provider item is a first-party track.
CREATE TABLE public.user_provider_favorites (
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, provider, provider_track_id)
);
CREATE INDEX user_provider_favorites_user_created_idx
  ON public.user_provider_favorites (user_id, created_at DESC);
ALTER TABLE public.user_provider_favorites ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read their own provider favorites"
  ON public.user_provider_favorites FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);
CREATE POLICY "Users can save their own provider favorites"
  ON public.user_provider_favorites FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY "Users can remove their own provider favorites"
  ON public.user_provider_favorites FOR DELETE TO authenticated
  USING ((SELECT auth.uid()) = user_id);
