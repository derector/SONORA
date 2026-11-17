-- Add covering indexes for foreign keys flagged by Supabase performance advisors.
-- These indexes are additive and do not change existing data or RLS policies.

CREATE INDEX IF NOT EXISTS tracks_album_id_idx
  ON public.tracks (album_id);

CREATE INDEX IF NOT EXISTS playlists_owner_id_idx
  ON public.playlists (owner_id);

CREATE INDEX IF NOT EXISTS playlist_tracks_track_id_idx
  ON public.playlist_tracks (track_id);

CREATE INDEX IF NOT EXISTS listening_events_track_id_idx
  ON public.listening_events (track_id);
