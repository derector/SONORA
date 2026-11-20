-- 010: Profile Center (профиль-центр) — additive only, safe to re-run.
-- Extends public.users with profile fields, adds follows/track feedback,
-- public read views that honour the new privacy setting, a listening_stats
-- view over provider_listening_events and the sonora-covers storage bucket.
-- Nothing here drops or rewrites existing columns, policies or tables.

-- ---------------------------------------------------------------------------
-- 1. users: profile fields
--    accent holds a built-in cover/gradient preset id (see the web preset ramp);
--    cover_url holds an uploaded image. role is an account preset, status is a
--    short free-text mood line shown under the name.
-- ---------------------------------------------------------------------------
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS bio TEXT,
  ADD COLUMN IF NOT EXISTS cover_url TEXT,
  ADD COLUMN IF NOT EXISTS accent TEXT,
  ADD COLUMN IF NOT EXISTS role TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT,
  ADD COLUMN IF NOT EXISTS links JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS privacy JSONB NOT NULL
    DEFAULT '{"history": true, "profile": "public", "comments": true}'::jsonb,
  ADD COLUMN IF NOT EXISTS favorite_genres JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_bio_length_check;
ALTER TABLE public.users
  ADD CONSTRAINT users_bio_length_check CHECK (bio IS NULL OR length(bio) <= 280);
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_status_length_check;
ALTER TABLE public.users
  ADD CONSTRAINT users_status_length_check CHECK (status IS NULL OR length(status) <= 60);
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_cover_url_length_check;
ALTER TABLE public.users
  ADD CONSTRAINT users_cover_url_length_check
  CHECK (cover_url IS NULL OR (char_length(cover_url) <= 2048 AND cover_url LIKE 'https://%'));

CREATE INDEX IF NOT EXISTS users_username_lower_idx ON public.users (lower(username));

-- Genre is not captured by the Jamendo listener today; the column gives the
-- web and Android lanes one honest place to store it so genre analytics stop
-- being guesswork. Existing rows stay NULL and are reported as unknown.
ALTER TABLE public.provider_listening_events
  ADD COLUMN IF NOT EXISTS genre TEXT;
ALTER TABLE public.provider_listening_events DROP CONSTRAINT IF EXISTS provider_listening_events_genre_len;
ALTER TABLE public.provider_listening_events
  ADD CONSTRAINT provider_listening_events_genre_len
  CHECK (genre IS NULL OR (length(genre) BETWEEN 1 AND 64));

-- ---------------------------------------------------------------------------
-- 2. user_follows: one row per follower/followee pair (web + APK sync).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_follows (
  follower_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  followee_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, followee_id),
  CONSTRAINT user_follows_no_self CHECK (follower_id <> followee_id)
);
CREATE INDEX IF NOT EXISTS user_follows_followee_idx
  ON public.user_follows (followee_id, created_at DESC);
CREATE INDEX IF NOT EXISTS user_follows_follower_idx
  ON public.user_follows (follower_id, created_at DESC);

ALTER TABLE public.user_follows ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Follow graph is readable by signed-in users" ON public.user_follows;
CREATE POLICY "Follow graph is readable by signed-in users"
  ON public.user_follows FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Users can follow from their own account" ON public.user_follows;
CREATE POLICY "Users can follow from their own account"
  ON public.user_follows FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = follower_id);
DROP POLICY IF EXISTS "Users can undo their own follows" ON public.user_follows;
CREATE POLICY "Users can undo their own follows"
  ON public.user_follows FOR DELETE TO authenticated USING ((SELECT auth.uid()) = follower_id);

-- ---------------------------------------------------------------------------
-- 3. track_feedback: like/dislike per track key, one current verdict per user.
--    track_key is provider-qualified (e.g. "jamendo:12345", "audius:abc").
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.track_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  track_key TEXT NOT NULL CHECK (length(track_key) BETWEEN 1 AND 160),
  kind TEXT NOT NULL CHECK (kind IN ('like', 'dislike')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT track_feedback_one_verdict_per_track UNIQUE (user_id, track_key)
);
CREATE INDEX IF NOT EXISTS track_feedback_user_time_idx
  ON public.track_feedback (user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS track_feedback_track_idx
  ON public.track_feedback (track_key);

ALTER TABLE public.track_feedback ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can read their own track feedback" ON public.track_feedback;
CREATE POLICY "Users can read their own track feedback"
  ON public.track_feedback FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
DROP POLICY IF EXISTS "Users can write their own track feedback" ON public.track_feedback;
CREATE POLICY "Users can write their own track feedback"
  ON public.track_feedback FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);
DROP POLICY IF EXISTS "Users can update their own track feedback" ON public.track_feedback;
CREATE POLICY "Users can update their own track feedback"
  ON public.track_feedback FOR UPDATE TO authenticated USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);
DROP POLICY IF EXISTS "Users can clear their own track feedback" ON public.track_feedback;
CREATE POLICY "Users can clear their own track feedback"
  ON public.track_feedback FOR DELETE TO authenticated USING ((SELECT auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- 4. listening_stats: artist/genre minutes by month over provider events.
--    security_invoker keeps owner-only RLS of the base table in force, so one
--    user can never read another user's aggregate. Older Postgres without view
--    row security simply keeps the definer default; the API filters by user.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.listening_stats AS
SELECT
  e.user_id,
  date_trunc('month', e.occurred_at)::date AS month,
  e.artist_name,
  e.genre,
  count(*) AS events,
  count(*) FILTER (WHERE e.event_type = 'complete') AS completions,
  count(*) FILTER (WHERE e.event_type = 'skip') AS skips,
  COALESCE(sum(e.listened_ms), 0) / 60000.0 AS minutes
FROM public.provider_listening_events e
GROUP BY e.user_id, date_trunc('month', e.occurred_at)::date, e.artist_name, e.genre;

DO $$
BEGIN
  ALTER VIEW public.listening_stats SET (security_invoker = on);
EXCEPTION WHEN others THEN
  RAISE NOTICE 'listening_stats view security_invoker skipped: %', SQLERRM;
END
$$;

GRANT SELECT ON public.listening_stats TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. Public read surfaces. Both views are owned by the migration role and are
--    the only way other accounts see profile data: they never expose email or
--    privacy settings, and the API refuses private profiles by visibility.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.public_profiles AS
SELECT
  u.id,
  u.username,
  u.display_name,
  u.avatar_url,
  u.cover_url,
  u.accent,
  u.role,
  u.status,
  u.bio,
  u.links,
  u.favorite_genres,
  u.created_at,
  COALESCE(lower(u.privacy ->> 'profile'), 'public') AS visibility
FROM public.users u;

CREATE OR REPLACE VIEW public.public_profile_stats AS
SELECT
  u.id AS user_id,
  (SELECT count(*) FROM public.user_provider_favorites f WHERE f.user_id = u.id) AS provider_favorites,
  (SELECT count(*) FROM public.user_favorites f WHERE f.user_id = u.id) AS catalog_favorites,
  (SELECT count(*) FROM public.playlists p WHERE p.owner_id = u.id) AS playlists,
  (SELECT count(*) FROM public.playlists p WHERE p.owner_id = u.id AND p.is_public) AS public_playlists,
  (SELECT count(*) FROM public.user_follows fo WHERE fo.followee_id = u.id) AS followers,
  (SELECT count(*) FROM public.user_follows fo WHERE fo.follower_id = u.id) AS following,
  (SELECT count(DISTINCT e.artist_name) FROM public.provider_listening_events e WHERE e.user_id = u.id) AS artists_heard
FROM public.users u;

GRANT SELECT ON public.public_profiles TO anon, authenticated;
GRANT SELECT ON public.public_profile_stats TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. sonora-covers bucket: same shape as sonora-avatars, path <uid>/cover.<ext>
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'sonora-covers',
  'sonora-covers',
  true,
  3145728,
  array['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
SET public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

DROP POLICY IF EXISTS "SONORA covers are publicly readable" ON storage.objects;
CREATE POLICY "SONORA covers are publicly readable"
ON storage.objects FOR SELECT TO public
USING (bucket_id = 'sonora-covers');

DROP POLICY IF EXISTS "Users can upload their own SONORA cover" ON storage.objects;
CREATE POLICY "Users can upload their own SONORA cover"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'sonora-covers'
  AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
);

DROP POLICY IF EXISTS "Users can update their own SONORA cover" ON storage.objects;
CREATE POLICY "Users can update their own SONORA cover"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'sonora-covers'
  AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
)
WITH CHECK (
  bucket_id = 'sonora-covers'
  AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
);

DROP POLICY IF EXISTS "Users can delete their own SONORA cover" ON storage.objects;
CREATE POLICY "Users can delete their own SONORA cover"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'sonora-covers'
  AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
);
