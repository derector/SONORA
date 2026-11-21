-- 012: preserve a safe public projection while keeping underlying user rows private.
-- PostgreSQL SECURITY INVOKER views require table-level privileges on their source
-- tables; the users table contains private fields, so public profiles remain a
-- deliberately filtered SECURITY DEFINER projection with a security barrier.

-- Public profile data is exposed only through public.public_profiles, which
-- already filters to profile_visibility='public' and omits email/privacy.
ALTER VIEW public.public_profiles RESET (security_invoker);
ALTER VIEW public.public_profiles SET (security_barrier = true);

-- Only the account owner may read their full users row directly.
DROP POLICY IF EXISTS "Public profiles are readable" ON public.users;
REVOKE SELECT ON TABLE public.users FROM anon;
REVOKE SELECT (
  id, email, username, display_name, avatar_url, created_at, updated_at,
  cover_url, accent, role, status, bio, links, favorite_genres, privacy,
  profile_visibility, show_history
) ON public.users FROM anon;
GRANT SELECT ON TABLE public.users TO authenticated;

-- The invoker follow view reads the underlying table through RLS. Public edges
-- are permitted only when both endpoints exist in the filtered public view.
DROP POLICY IF EXISTS "Public follow edges are readable" ON public.user_follows;
CREATE POLICY "Public follow edges are readable"
  ON public.user_follows FOR SELECT TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.public_profiles follower
      WHERE follower.id = follower_id
    )
    AND EXISTS (
      SELECT 1 FROM public.public_profiles followee
      WHERE followee.id = followee_id
    )
  );

-- Keep the SECURITY DEFINER aggregate implementation in a non-exposed schema.
-- The public RPC is SECURITY INVOKER and returns only the narrow aggregate result.
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO anon, authenticated;

CREATE OR REPLACE FUNCTION private.get_public_profile_stats(target_ids uuid[])
RETURNS TABLE (
  user_id uuid,
  provider_favorites bigint,
  catalog_favorites bigint,
  playlists bigint,
  public_playlists bigint,
  followers bigint,
  following bigint
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
    (SELECT count(*) FROM public.user_follows fo WHERE fo.follower_id = u.id) AS following
  FROM public.users u
  WHERE u.id = ANY(target_ids)
    AND u.profile_visibility = 'public';
$function$;

REVOKE ALL ON FUNCTION private.get_public_profile_stats(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.get_public_profile_stats(uuid[]) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_public_profile_stats(target_ids uuid[])
RETURNS TABLE (
  user_id uuid,
  provider_favorites bigint,
  catalog_favorites bigint,
  playlists bigint,
  public_playlists bigint,
  followers bigint,
  following bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
  SELECT * FROM private.get_public_profile_stats(target_ids);
$function$;

REVOKE ALL ON FUNCTION public.get_public_profile_stats(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_profile_stats(uuid[]) TO anon, authenticated;
