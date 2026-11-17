-- Extend provider-backed playlists to the public Audius catalog.
-- Audio is still streamed from Audius; SONORA stores attribution and source metadata only.
ALTER TABLE public.provider_playlist_tracks
  DROP CONSTRAINT IF EXISTS provider_playlist_tracks_provider_check;
ALTER TABLE public.provider_playlist_tracks
  ADD CONSTRAINT provider_playlist_tracks_provider_check
  CHECK (provider IN ('jamendo', 'audius'));

ALTER TABLE public.provider_playlist_tracks
  DROP CONSTRAINT IF EXISTS provider_playlist_tracks_provider_track_id_check;
ALTER TABLE public.provider_playlist_tracks
  ADD CONSTRAINT provider_playlist_tracks_provider_track_id_check
  CHECK (length(provider_track_id) BETWEEN 1 AND 64);
