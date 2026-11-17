CREATE TABLE public.provider_playlist_tracks (
  playlist_id UUID NOT NULL REFERENCES public.playlists(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider = 'jamendo'),
  provider_track_id TEXT NOT NULL CHECK (length(provider_track_id) BETWEEN 1 AND 24),
  title TEXT NOT NULL,
  artist_name TEXT NOT NULL,
  album_name TEXT,
  duration_seconds INTEGER CHECK (duration_seconds IS NULL OR duration_seconds > 0),
  artwork_url TEXT,
  license_url TEXT NOT NULL,
  source_url TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 0),
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (playlist_id, provider, provider_track_id),
  UNIQUE (playlist_id, position)
);
CREATE INDEX provider_playlist_tracks_order_idx
  ON public.provider_playlist_tracks (playlist_id, position);
ALTER TABLE public.provider_playlist_tracks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read provider tracks in their own playlists"
  ON public.provider_playlist_tracks FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.playlists p
    WHERE p.id = playlist_id AND p.owner_id = (SELECT auth.uid())
  ));
CREATE POLICY "Users can add provider tracks to their own playlists"
  ON public.provider_playlist_tracks FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.playlists p
    WHERE p.id = playlist_id AND p.owner_id = (SELECT auth.uid())
  ));
CREATE POLICY "Users can remove provider tracks from their own playlists"
  ON public.provider_playlist_tracks FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.playlists p
    WHERE p.id = playlist_id AND p.owner_id = (SELECT auth.uid())
  ));