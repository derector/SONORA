-- SONORA initial relational model.
-- This migration intentionally contains no sample users or copyrighted catalog data.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE artists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  external_provider TEXT,
  external_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (external_provider, external_id)
);

CREATE TABLE albums (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  artist_id UUID REFERENCES artists(id) ON DELETE SET NULL,
  artwork_url TEXT,
  release_date DATE,
  external_provider TEXT,
  external_id TEXT,
  UNIQUE (external_provider, external_id)
);

CREATE TABLE tracks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  album_id UUID REFERENCES albums(id) ON DELETE SET NULL,
  artist_id UUID REFERENCES artists(id) ON DELETE SET NULL,
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

CREATE TABLE playlists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  is_public BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE playlist_tracks (
  playlist_id UUID NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  track_id UUID NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 0),
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (playlist_id, track_id),
  UNIQUE (playlist_id, position)
);

CREATE TABLE listening_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  track_id UUID NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('play', 'complete', 'skip', 'like')),
  listened_ms INTEGER NOT NULL DEFAULT 0 CHECK (listened_ms >= 0),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX listening_events_user_time_idx ON listening_events (user_id, occurred_at DESC);
CREATE INDEX playlist_tracks_order_idx ON playlist_tracks (playlist_id, position);
CREATE INDEX tracks_artist_idx ON tracks (artist_id);
CREATE INDEX albums_artist_idx ON albums (artist_id);

-- Playback authorization must be evaluated by the API at request time.
-- Never treat a catalog URL or provider ID alone as proof of streaming rights.
