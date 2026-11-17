-- SONORA initial schema with row-level security.
-- Profile IDs are supplied by Supabase Auth (auth.uid()).
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE public.users (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.artists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  external_provider TEXT,
  external_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (external_provider, external_id)
);

CREATE TABLE public.albums (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  artist_id UUID REFERENCES public.artists(id) ON DELETE SET NULL,
  artwork_url TEXT,
  release_date DATE,
  external_provider TEXT,
  external_id TEXT,
  UNIQUE (external_provider, external_id)
);

CREATE TABLE public.tracks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  album_id UUID REFERENCES public.albums(id) ON DELETE SET NULL,
  artist_id UUID REFERENCES public.artists(id) ON DELETE SET NULL,
  duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms > 0),
  artwork_url TEXT,
  playback_provider TEXT NOT NULL,
  playback_reference TEXT NOT NULL,
  territory_codes TEXT[] NOT NULL DEFAULT '{}',
  rights_status TEXT NOT NULL DEFAULT 'unverified'
    CHECK (rights_status IN ('unverified', 'preview_only', 'licensed', 'unavailable')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (playback_provider, playback_reference)
);

CREATE TABLE public.playlists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  is_public BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.playlist_tracks (
  playlist_id UUID NOT NULL REFERENCES public.playlists(id) ON DELETE CASCADE,
  track_id UUID NOT NULL REFERENCES public.tracks(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 0),
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (playlist_id, track_id),
  UNIQUE (playlist_id, position)
);

CREATE TABLE public.listening_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  track_id UUID NOT NULL REFERENCES public.tracks(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('play', 'complete', 'skip', 'like')),
  listened_ms INTEGER NOT NULL DEFAULT 0 CHECK (listened_ms >= 0),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX listening_events_user_time_idx ON public.listening_events (user_id, occurred_at DESC);
CREATE INDEX playlist_tracks_order_idx ON public.playlist_tracks (playlist_id, position);
CREATE INDEX tracks_artist_idx ON public.tracks (artist_id);
CREATE INDEX albums_artist_idx ON public.albums (artist_id);

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.artists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.albums ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tracks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.playlists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.playlist_tracks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.listening_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read their own profile" ON public.users
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = id);
CREATE POLICY "Users can create their own profile" ON public.users
  FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = id);
CREATE POLICY "Users can update their own profile" ON public.users
  FOR UPDATE TO authenticated USING ((SELECT auth.uid()) = id)
  WITH CHECK ((SELECT auth.uid()) = id);

CREATE POLICY "Catalog artists are readable" ON public.artists
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Catalog albums are readable" ON public.albums
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Catalog tracks are readable" ON public.tracks
  FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "Public playlists and owned playlists are readable" ON public.playlists
  FOR SELECT TO anon, authenticated
  USING (is_public OR (SELECT auth.uid()) = owner_id);
CREATE POLICY "Users can create their own playlists" ON public.playlists
  FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = owner_id);
CREATE POLICY "Users can update their own playlists" ON public.playlists
  FOR UPDATE TO authenticated USING ((SELECT auth.uid()) = owner_id)
  WITH CHECK ((SELECT auth.uid()) = owner_id);
CREATE POLICY "Users can delete their own playlists" ON public.playlists
  FOR DELETE TO authenticated USING ((SELECT auth.uid()) = owner_id);

CREATE POLICY "Playlist tracks follow playlist visibility" ON public.playlist_tracks
  FOR SELECT TO anon, authenticated
  USING (EXISTS (
    SELECT 1 FROM public.playlists p
    WHERE p.id = playlist_id AND (p.is_public OR p.owner_id = (SELECT auth.uid()))
  ));
CREATE POLICY "Owners can add playlist tracks" ON public.playlist_tracks
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.playlists p
    WHERE p.id = playlist_id AND p.owner_id = (SELECT auth.uid())
  ));
CREATE POLICY "Owners can remove playlist tracks" ON public.playlist_tracks
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.playlists p
    WHERE p.id = playlist_id AND p.owner_id = (SELECT auth.uid())
  ));

CREATE POLICY "Users can read their listening events" ON public.listening_events
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY "Users can add their listening events" ON public.listening_events
  FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);

-- Playback authorization must be checked by the API at request time.
-- A catalog URL or provider ID alone is never proof of streaming rights.
