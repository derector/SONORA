-- Universal Music Discovery & Import Engine: import matching gained a third
-- licensed stage (Internet Archive, Openverse, ccMixter open catalogs), so
-- the storage CHECK constraints that predate migration 006's Audius addition
-- must accept those provider ids. Openly licensed audio only; commercial
-- platforms remain link/preview-only and never enter these tables.

ALTER TABLE public.provider_playlist_tracks
  DROP CONSTRAINT IF EXISTS provider_playlist_tracks_provider_check;
ALTER TABLE public.provider_playlist_tracks
  ADD CONSTRAINT provider_playlist_tracks_provider_check
  CHECK (provider IN ('jamendo', 'audius', 'internet_archive', 'openverse', 'ccmixter'));

ALTER TABLE public.import_items
  DROP CONSTRAINT IF EXISTS import_items_matched_provider_check;
ALTER TABLE public.import_items
  ADD CONSTRAINT import_items_matched_provider_check
  CHECK (matched_provider IS NULL OR matched_provider IN ('jamendo', 'audius', 'internet_archive', 'openverse', 'ccmixter'));
