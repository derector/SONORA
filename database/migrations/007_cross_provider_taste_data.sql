-- Expand provider-qualified taste storage without changing first-party track IDs.
-- Jamendo remains subject to the API's existing Creative Commons verification.
-- Audius may expose a license label (including "All rights reserved") without a URL.
ALTER TABLE public.user_provider_favorites
  DROP CONSTRAINT IF EXISTS user_provider_favorites_provider_check;
ALTER TABLE public.user_provider_favorites
  ADD CONSTRAINT user_provider_favorites_provider_check
  CHECK (provider IN ('jamendo', 'audius'));

ALTER TABLE public.provider_listening_events
  DROP CONSTRAINT IF EXISTS provider_listening_events_provider_check;
ALTER TABLE public.provider_listening_events
  ADD CONSTRAINT provider_listening_events_provider_check
  CHECK (provider IN ('jamendo', 'audius'));

ALTER TABLE public.user_provider_favorites
  ALTER COLUMN license_url DROP NOT NULL;
ALTER TABLE public.provider_listening_events
  ALTER COLUMN license_url DROP NOT NULL;

ALTER TABLE public.user_provider_favorites
  ADD COLUMN IF NOT EXISTS license_name TEXT;
ALTER TABLE public.provider_listening_events
  ADD COLUMN IF NOT EXISTS license_name TEXT;

-- Provider-qualified identity remains (user_id, provider, provider_track_id).
-- Existing RLS policies remain enabled and continue to scope rows by auth.uid().
