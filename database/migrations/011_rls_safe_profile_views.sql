-- 011: make public profile projections respect RLS without exposing private columns.
-- The public views use SECURITY INVOKER; row visibility is enforced by users/user_follows RLS.
-- Public aggregate counts are returned only by a narrowly scoped SECURITY DEFINER function.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS profile_visibility text
    GENERATED ALWAYS AS (lower(COALESCE(privacy ->> 'profile', 'public'))) STORED,
  ADD COLUMN IF NOT EXISTS show_history boolean
    GENERATED ALWAYS AS (lower(COALESCE(privacy ->> 'history', 'false')) = 'true') STORED;

DROP POLICY IF EXISTS "Public profiles are readable" ON public.users;
CREATE POLICY "Public profiles are readable"
  ON public.users FOR SELECT TO anon, authenticated
  USING (profile_visibility = 'public');

-- Column-level grants ensure the new public row policy never makes email or the
-- raw privacy document readable through the public REST API.
REVOKE SELECT ON TABLE public.users FROM anon, authenticated;
REVOKE SELECT (email, privacy, updated_at) ON public.users FROM anon;
REVOKE SELECT (email) ON public.users FROM authenticated;
GRANT SELECT (
  id, username, display_name, avatar_url, cover_url, accent, role, status,
  bio, links, favorite_genres, created_at, profile_visibility, show_history
) ON public.users TO anon;
GRANT SELECT (
  id, username, display_name, avatar_url, cover_url, accent, role, status,
  bio, links, favorite_genres, created_at, updated_at, privacy,
  profile_visibility, show_history
) ON public.users TO authenticated;

-- Public profile views now run with the caller's permissions and RLS policies.
ALTER VIEW public.public_profiles
  SET (security_invoker = true, security_barrier = true);
ALTER VIEW public.public_follow_edges
  SET (security_invoker = true, security_barrier = true);

-- A follow edge is public only when both endpoints have public profiles.
-- Authenticated users retain access to edges involving their own account.
DROP POLICY IF EXISTS "Public follow edges are readable" ON public.user_follows;
CREATE POLICY "Public follow edges are readable"
  ON public.user_follows FOR SELECT TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users follower
      WHERE follower.id = follower_id AND follower.profile_visibility = 'public'
    )
    AND EXISTS (
      SELECT 1 FROM public.users followee
      WHERE followee.id = followee_id AND followee.profile_visibility = 'public'
    )
  );
GRANT SELECT ON public.user_follows TO anon, authenticated;

-- The old aggregate view bypassed RLS. Replace it with a function that returns
-- counts only for explicitly public profiles and exposes no underlying rows.
DROP VIEW IF EXISTS public.public_profile_stats;
CREATE OR REPLACE FUNCTION public.get_public_profile_stats(target_ids uuid[])
RETURNS TABLE (
  user_id uuid,
  provider_favorites bigint,
  catalog_favorites bigint,
  playlists bigint,
  public_playlists bigint,
  followers bigint,
  following bigint,
  artists_heard bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT
    u.id AS user_id,
    (SELECT count(*) FROM public.user_provider_favorites f WHERE f.user_id = u.id) AS provider_favorites,
    (SELECT count(*) FROM public.user_favorites f WHERE f.user_id = u.id) AS catalog_favorites,
    (SELECT count(*) FROM public.playlists p WHERE p.owner_id = u.id) AS playlists,
    (SELECT count(*) FROM public.playlists p WHERE p.owner_id = u.id AND p.is_public) AS public_playlists,
    (SELECT count(*) FROM public.user_follows fo WHERE fo.followee_id = u.id) AS followers,
    (SELECT count(*) FROM public.user_follows fo WHERE fo.follower_id = u.id) AS following,
    (SELECT count(DISTINCT e.artist_name) FROM public.provider_listening_events e WHERE e.user_id = u.id) AS artists_heard
  FROM public.users u
  WHERE u.id = ANY(target_ids)
    AND u.profile_visibility = 'public';
$function$;

REVOKE ALL ON FUNCTION public.get_public_profile_stats(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_profile_stats(uuid[]) TO anon, authenticated;
