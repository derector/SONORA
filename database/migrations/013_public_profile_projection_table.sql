-- 013: replace the public SECURITY DEFINER view with a safe projection table.
-- This preserves the public API shape while allowing RLS to apply normally.

DROP POLICY IF EXISTS "Public follow edges are readable" ON public.user_follows;
DROP VIEW IF EXISTS public.public_follow_edges;
DROP VIEW IF EXISTS public.public_profiles;

CREATE TABLE public.public_profiles (
  id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  username text NOT NULL,
  display_name text,
  avatar_url text,
  cover_url text,
  accent text,
  role text,
  status text,
  bio text,
  links jsonb NOT NULL DEFAULT '[]'::jsonb,
  favorite_genres jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  visibility text NOT NULL DEFAULT 'public' CHECK (visibility = 'public'),
  show_history boolean NOT NULL DEFAULT false
);

CREATE UNIQUE INDEX public_profiles_username_lower_idx
  ON public.public_profiles (lower(username));

ALTER TABLE public.public_profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.public_profiles FROM anon, authenticated;
GRANT SELECT ON TABLE public.public_profiles TO anon, authenticated;
CREATE POLICY "Public profiles are readable"
  ON public.public_profiles FOR SELECT TO anon, authenticated USING (true);

CREATE OR REPLACE FUNCTION private.sync_public_profile_projection()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.public_profiles WHERE id = OLD.id;
    RETURN OLD;
  END IF;

  IF NEW.profile_visibility = 'public' THEN
    INSERT INTO public.public_profiles (
      id, username, display_name, avatar_url, cover_url, accent, role, status,
      bio, links, favorite_genres, created_at, visibility, show_history
    ) VALUES (
      NEW.id, NEW.username, NEW.display_name, NEW.avatar_url, NEW.cover_url,
      NEW.accent, NEW.role, NEW.status, NEW.bio, COALESCE(NEW.links, '[]'::jsonb),
      COALESCE(NEW.favorite_genres, '[]'::jsonb), NEW.created_at,
      'public', COALESCE(NEW.show_history, false)
    )
    ON CONFLICT (id) DO UPDATE SET
      username = EXCLUDED.username,
      display_name = EXCLUDED.display_name,
      avatar_url = EXCLUDED.avatar_url,
      cover_url = EXCLUDED.cover_url,
      accent = EXCLUDED.accent,
      role = EXCLUDED.role,
      status = EXCLUDED.status,
      bio = EXCLUDED.bio,
      links = EXCLUDED.links,
      favorite_genres = EXCLUDED.favorite_genres,
      created_at = EXCLUDED.created_at,
      visibility = 'public',
      show_history = EXCLUDED.show_history;
  ELSE
    DELETE FROM public.public_profiles WHERE id = NEW.id;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION private.sync_public_profile_projection() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS users_sync_public_profile_projection ON public.users;
CREATE TRIGGER users_sync_public_profile_projection
AFTER INSERT OR UPDATE OR DELETE ON public.users
FOR EACH ROW EXECUTE FUNCTION private.sync_public_profile_projection();

-- Backfill only explicitly public profiles; no private fields are copied.
INSERT INTO public.public_profiles (
  id, username, display_name, avatar_url, cover_url, accent, role, status,
  bio, links, favorite_genres, created_at, visibility, show_history
)
SELECT
  id, username, display_name, avatar_url, cover_url, accent, role, status,
  bio, COALESCE(links, '[]'::jsonb), COALESCE(favorite_genres, '[]'::jsonb),
  created_at, 'public', COALESCE(show_history, false)
FROM public.users
WHERE profile_visibility = 'public'
ON CONFLICT (id) DO UPDATE SET
  username = EXCLUDED.username,
  display_name = EXCLUDED.display_name,
  avatar_url = EXCLUDED.avatar_url,
  cover_url = EXCLUDED.cover_url,
  accent = EXCLUDED.accent,
  role = EXCLUDED.role,
  status = EXCLUDED.status,
  bio = EXCLUDED.bio,
  links = EXCLUDED.links,
  favorite_genres = EXCLUDED.favorite_genres,
  created_at = EXCLUDED.created_at,
  visibility = 'public',
  show_history = EXCLUDED.show_history;

CREATE VIEW public.public_follow_edges
WITH (security_invoker = true, security_barrier = true) AS
SELECT f.follower_id, f.followee_id, f.created_at
FROM public.user_follows f
JOIN public.public_profiles follower ON follower.id = f.follower_id
JOIN public.public_profiles followee ON followee.id = f.followee_id;

GRANT SELECT ON public.public_follow_edges TO anon, authenticated;
CREATE POLICY "Public follow edges are readable"
  ON public.user_follows FOR SELECT TO anon, authenticated
  USING (
    EXISTS (SELECT 1 FROM public.public_profiles follower WHERE follower.id = follower_id)
    AND EXISTS (SELECT 1 FROM public.public_profiles followee WHERE followee.id = followee_id)
  );
